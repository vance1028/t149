'use strict';

const store = require('../data/store');
const scheduler = require('./ownership-scheduler');
const transitionHandler = require('./transition-handler');

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatTimeKey(date) {
  return date.toISOString().slice(11, 19);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function diffMinutes(start, end) {
  return Math.max(0, Math.round((end - start) / (60 * 1000)));
}

async function getRatePlanForRule(ruleId) {
  if (!ruleId) return null;
  const rule = await store.getOwnershipRuleById(ruleId);
  if (!rule) return null;
  return store.getRatePlanById(rule.ratePlanId);
}

async function getRuleAtTime(spaceId, time) {
  return scheduler.findApplicableRuleForSpace(spaceId, time);
}

async function findTimeSegmentTransitions(spaceId, startTime, endTime) {
  const transitions = [];
  let currentTime = new Date(startTime);
  const maxIterations = 24 * 60 / 5;

  for (let i = 0; i < maxIterations && currentTime < endTime; i++) {
    const nextTransition = await scheduler.findNextTransitionForSpace(spaceId, currentTime);
    if (!nextTransition || nextTransition.transitionTime >= endTime) {
      break;
    }
    transitions.push({
      time: nextTransition.transitionTime,
      ruleId: nextTransition.nextRule?.id || null,
      ownershipType: nextTransition.nextRule?.ownershipType || scheduler.OWNERSHIP_TYPES.SHARED,
    });
    currentTime = new Date(nextTransition.transitionTime);
  }

  return transitions;
}

async function buildTimeSegments(spaceId, startTime, endTime) {
  const startRule = await getRuleAtTime(spaceId, startTime);
  const transitions = await findTimeSegmentTransitions(spaceId, startTime, endTime);

  const segments = [];
  let segmentStart = new Date(startTime);
  let currentRuleId = startRule?.id || null;
  let currentOwnership = startRule?.ownershipType || scheduler.OWNERSHIP_TYPES.SHARED;

  for (const transition of transitions) {
    if (transition.time > segmentStart && transition.time <= endTime) {
      segments.push({
        segmentStart: new Date(segmentStart),
        segmentEnd: new Date(transition.time),
        ruleId: currentRuleId,
        ownershipType: currentOwnership,
        durationMin: diffMinutes(segmentStart, transition.time),
      });
      segmentStart = new Date(transition.time);
      currentRuleId = transition.ruleId;
      currentOwnership = transition.ownershipType;
    }
  }

  if (segmentStart < endTime) {
    segments.push({
      segmentStart: new Date(segmentStart),
      segmentEnd: new Date(endTime),
      ruleId: currentRuleId,
      ownershipType: currentOwnership,
      durationMin: diffMinutes(segmentStart, endTime),
    });
  }

  return segments;
}

async function calculateSegmentFee(segment, session, overtimeMultiplier = 1.0) {
  if (!segment.ruleId) {
    return {
      ...segment,
      rateCents: 0,
      amountCents: 0,
      isOvertime: overtimeMultiplier > 1.0,
    };
  }

  const ratePlan = await getRatePlanForRule(segment.ruleId);
  if (!ratePlan) {
    return {
      ...segment,
      rateCents: 0,
      amountCents: 0,
      isOvertime: overtimeMultiplier > 1.0,
    };
  }

  const isExclusive = segment.ownershipType === scheduler.OWNERSHIP_TYPES.EXCLUSIVE;

  if (isExclusive && ratePlan.isExclusive) {
    const whitelisted = await store.isPlateInWhitelist(session.plateNo, null, segment.segmentStart);
    if (whitelisted) {
      return {
        ...segment,
        rateCents: 0,
        amountCents: 0,
        isOvertime: false,
        note: '专属时段白名单车辆免费',
      };
    }
  }

  let billableMinutes = segment.durationMin;
  if (ratePlan.freeMinutes && segment.durationMin <= ratePlan.freeMinutes) {
    billableMinutes = 0;
  } else if (ratePlan.freeMinutes) {
    billableMinutes = segment.durationMin - ratePlan.freeMinutes;
  }

  const hourlyRate = ratePlan.baseRateCents * overtimeMultiplier;
  const billableHours = billableMinutes / 60;
  let amountCents = Math.round(hourlyRate * billableHours);

  if (ratePlan.maxDailyCents && amountCents > ratePlan.maxDailyCents) {
    amountCents = ratePlan.maxDailyCents;
  }

  return {
    ...segment,
    rateCents: Math.round(hourlyRate),
    amountCents,
    isOvertime: overtimeMultiplier > 1.0,
    billableMinutes,
    freeMinutes: ratePlan.freeMinutes,
  };
}

async function calculateBillingSegments(sessionId) {
  const session = await store.getSessionById(sessionId);
  if (!session) return { segments: [], totalCents: 0 };

  const endTime = session.exitTime ? new Date(session.exitTime) : new Date();
  const startTime = new Date(session.enterTime);

  if (!session.spaceId) {
    return {
      segments: [{
        segmentStart: startTime,
        segmentEnd: endTime,
        ruleId: null,
        ownershipType: scheduler.OWNERSHIP_TYPES.SHARED,
        durationMin: diffMinutes(startTime, endTime),
        rateCents: 0,
        amountCents: 0,
        isOvertime: false,
        note: '未分配车位，不计费',
      }],
      totalCents: 0,
    };
  }

  const segments = await buildTimeSegments(session.spaceId, startTime, endTime);
  const overtimeMultiplier = session.exitTime
    ? await transitionHandler.calculateOvertimeMultiplier(sessionId, new Date(session.exitTime))
    : 1.0;

  const calculatedSegments = [];
  let totalCents = 0;

  for (const segment of segments) {
    const segmentOvertimeMultiplier = segment.segmentEnd > (session.exitTime || new Date())
      ? overtimeMultiplier
      : 1.0;

    const calculated = await calculateSegmentFee(segment, session, segmentOvertimeMultiplier);
    calculatedSegments.push(calculated);
    totalCents += calculated.amountCents;
  }

  return { segments: calculatedSegments, totalCents };
}

async function saveBillingSegments(sessionId) {
  const { segments, totalCents } = await calculateBillingSegments(sessionId);

  await store.deleteSegmentsForSession(sessionId);

  for (const segment of segments) {
    if (segment.ruleId) {
      await store.createBillingSegment({
        sessionId,
        ruleId: segment.ruleId,
        segmentStart: segment.segmentStart,
        segmentEnd: segment.segmentEnd,
        durationMin: segment.durationMin,
        rateCents: segment.rateCents,
        amountCents: segment.amountCents,
        isOvertime: segment.isOvertime,
      });
    }
  }

  return { segments, totalCents };
}

async function recalculateSessionFee(sessionId) {
  const { segments, totalCents } = await saveBillingSegments(sessionId);
  await store.updateSession(sessionId, { feeCents: totalCents });
  return { segments, totalCents };
}

async function getSessionBillingDetails(sessionId) {
  const session = await store.getSessionById(sessionId);
  if (!session) return null;

  const segments = await store.getSegmentsForSession(sessionId);
  const hasSegments = segments.length > 0;

  let calculated;
  if (!hasSegments) {
    calculated = await calculateBillingSegments(sessionId);
  } else {
    const totalCents = segments.reduce((sum, s) => sum + s.amountCents, 0);
    calculated = { segments, totalCents };
  }

  return {
    session,
    segments: calculated.segments,
    totalCents: calculated.totalCents,
    saved: hasSegments,
  };
}

async function getBillingSummaryByDate(date, lotId = null) {
  const dateStr = typeof date === 'string' ? date : formatDateKey(date);
  const startOfDay = new Date(`${dateStr}T00:00:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999`);

  const filter = {};
  if (lotId) filter.lotId = lotId;
  const spaces = await store.listSpaces(filter);
  const spaceIds = spaces.map(s => s.id);

  const [sessions] = await store.getPool().query(
    `SELECT * FROM parking_sessions 
     WHERE space_id IN (${spaceIds.map(() => '?').join(',')})
       AND exit_time >= ? AND enter_time <= ?
       AND status = 'FINISHED'`,
    [...spaceIds, startOfDay, endOfDay]
  );

  const summary = {
    date: dateStr,
    totalSessions: sessions.length,
    totalMinutes: 0,
    totalCents: 0,
    byOwnershipType: {
      EXCLUSIVE: { sessions: 0, minutes: 0, cents: 0 },
      SHARED: { sessions: 0, minutes: 0, cents: 0 },
    },
    bySpace: {},
  };

  for (const space of spaces) {
    summary.bySpace[space.id] = {
      spaceCode: space.code,
      sessions: 0,
      minutes: 0,
      cents: 0,
    };
  }

  for (const session of sessions) {
    const details = await getSessionBillingDetails(session.id);
    if (!details) continue;

    summary.totalMinutes += details.segments.reduce((sum, s) => sum + s.durationMin, 0);
    summary.totalCents += details.totalCents;

    for (const segment of details.segments) {
      const type = segment.ownershipType || 'SHARED';
      if (summary.byOwnershipType[type]) {
        summary.byOwnershipType[type].minutes += segment.durationMin;
        summary.byOwnershipType[type].cents += segment.amountCents;
      }
    }

    if (summary.bySpace[session.space_id]) {
      summary.bySpace[session.space_id].sessions += 1;
      summary.bySpace[session.space_id].minutes += diffMinutes(
        new Date(session.enter_time),
        new Date(session.exit_time)
      );
      summary.bySpace[session.space_id].cents += details.totalCents;
    }
  }

  summary.byOwnershipType.EXCLUSIVE.sessions = sessions.filter(s => {
    const details = getSessionBillingDetails(s.id);
    return details?.segments?.some(seg => seg.ownershipType === 'EXCLUSIVE');
  }).length;
  summary.byOwnershipType.SHARED.sessions = summary.totalSessions - summary.byOwnershipType.EXCLUSIVE.sessions;

  return summary;
}

module.exports = {
  buildTimeSegments,
  calculateSegmentFee,
  calculateBillingSegments,
  saveBillingSegments,
  recalculateSessionFee,
  getSessionBillingDetails,
  getBillingSummaryByDate,
  getRatePlanForRule,
  diffMinutes,
};
