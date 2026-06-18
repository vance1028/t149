'use strict';

const store = require('../data/store');
const scheduler = require('./ownership-scheduler');

const TRANSITION_ACTIONS = {
  GRACE_PERIOD: 'GRACE_PERIOD',
  OVERTIME_CHARGE: 'OVERTIME_CHARGE',
  FORCE_EXIT: 'FORCE_EXIT',
  NOTIFY_MOVE: 'NOTIFY_MOVE',
};

async function getGracePeriodMinutes(ruleId) {
  if (!ruleId) return 30;
  const rule = await store.getOwnershipRuleById(ruleId);
  if (!rule) return 30;
  const ratePlan = await store.getRatePlanById(rule.ratePlanId);
  return ratePlan?.gracePeriodMinutes || 30;
}

async function getOvertimeMultiplier(ruleId) {
  if (!ruleId) return 1.5;
  const rule = await store.getOwnershipRuleById(ruleId);
  if (!rule) return 1.5;
  const ratePlan = await store.getRatePlanById(rule.ratePlanId);
  return ratePlan?.overtimeMultiplier || 1.5;
}

async function handleSharedToExclusiveTransition(transition, session) {
  const graceMinutes = await getGracePeriodMinutes(transition.toRuleId);
  const graceExpiry = new Date(transition.transitionTime.getTime() + graceMinutes * 60 * 1000);

  const isWhitelisted = session && transition.toOrgId
    ? await store.isPlateInWhitelist(session.plateNo, transition.toOrgId, transition.transitionTime)
    : false;

  if (isWhitelisted) {
    return store.createTransitionEvent({
      spaceId: transition.spaceId,
      sessionId: session.id,
      fromRuleId: transition.fromRuleId,
      toRuleId: transition.toRuleId,
      transitionTime: transition.transitionTime,
      actionTaken: TRANSITION_ACTIONS.NOTIFY_MOVE,
      note: '白名单车辆，已自动转为专属时段',
      notified: true,
    });
  }

  return store.createTransitionEvent({
    spaceId: transition.spaceId,
    sessionId: session.id,
    fromRuleId: transition.fromRuleId,
    toRuleId: transition.toRuleId,
    transitionTime: transition.transitionTime,
    actionTaken: TRANSITION_ACTIONS.GRACE_PERIOD,
    graceExpiry,
    note: `共享转专属，宽限期${graceMinutes}分钟`,
    notified: false,
  });
}

async function handleExclusiveToSharedTransition(transition, session) {
  return store.createTransitionEvent({
    spaceId: transition.spaceId,
    sessionId: session.id,
    fromRuleId: transition.fromRuleId,
    toRuleId: transition.toRuleId,
    transitionTime: transition.transitionTime,
    actionTaken: TRANSITION_ACTIONS.NOTIFY_MOVE,
    note: '专属转共享，车辆可继续停放，按共享费率计费',
    notified: false,
  });
}

async function handleTransition(transition) {
  const session = await store.getParkedSessionForSpace(transition.spaceId);
  if (!session) {
    return store.createTransitionEvent({
      spaceId: transition.spaceId,
      sessionId: null,
      fromRuleId: transition.fromRuleId,
      toRuleId: transition.toRuleId,
      transitionTime: transition.transitionTime,
      actionTaken: 'NO_ACTION',
      note: '车位空闲，无车辆需处理',
      notified: true,
    });
  }

  if (transition.fromOwnership === scheduler.OWNERSHIP_TYPES.SHARED &&
      transition.toOwnership === scheduler.OWNERSHIP_TYPES.EXCLUSIVE) {
    return handleSharedToExclusiveTransition(transition, session);
  }

  if (transition.fromOwnership === scheduler.OWNERSHIP_TYPES.EXCLUSIVE &&
      transition.toOwnership === scheduler.OWNERSHIP_TYPES.SHARED) {
    return handleExclusiveToSharedTransition(transition, session);
  }

  return store.createTransitionEvent({
    spaceId: transition.spaceId,
    sessionId: session.id,
    fromRuleId: transition.fromRuleId,
    toRuleId: transition.toRuleId,
    transitionTime: transition.transitionTime,
    actionTaken: TRANSITION_ACTIONS.NOTIFY_MOVE,
    note: `${transition.fromOwnership} 转 ${transition.toOwnership}`,
    notified: false,
  });
}

async function processPendingTransitions(currentTime = new Date()) {
  const pendingEvents = await store.getPendingTransitions(currentTime);
  const results = [];

  for (const event of pendingEvents) {
    const session = await store.getSessionById(event.sessionId);
    if (!session || session.status !== 'PARKED') {
      await store.markTransitionNotified(event.id);
      continue;
    }

    const overtimeMultiplier = await getOvertimeMultiplier(event.toRuleId);
    const updated = await store.createTransitionEvent({
      spaceId: event.spaceId,
      sessionId: event.sessionId,
      fromRuleId: event.fromRuleId,
      toRuleId: event.toRuleId,
      transitionTime: currentTime,
      actionTaken: TRANSITION_ACTIONS.OVERTIME_CHARGE,
      note: `宽限期已过，超时加收${overtimeMultiplier}倍`,
      notified: true,
    });

    if (!session.transitionNotified) {
      await store.updateSession(session.id, { transitionNotified: true });
    }

    await store.markTransitionNotified(event.id);
    results.push({ eventId: event.id, action: TRANSITION_ACTIONS.OVERTIME_CHARGE, overtimeMultiplier });
  }

  return results;
}

async function isInGracePeriod(sessionId, currentTime = new Date()) {
  const events = await store.listTransitionEvents({
    sessionId,
    fromTime: new Date(currentTime.getTime() - 24 * 60 * 60 * 1000),
  });

  for (const event of events) {
    if (event.actionTaken === TRANSITION_ACTIONS.GRACE_PERIOD &&
        event.graceExpiry &&
        new Date(event.graceExpiry) > currentTime &&
        !event.notified) {
      return { inGrace: true, graceExpiry: event.graceExpiry, event };
    }
  }

  return { inGrace: false };
}

async function calculateOvertimeMultiplier(sessionId, currentTime = new Date()) {
  const graceStatus = await isInGracePeriod(sessionId, currentTime);
  if (graceStatus.inGrace) return 1.0;

  const events = await store.listTransitionEvents({
    sessionId,
    fromTime: new Date(currentTime.getTime() - 24 * 60 * 60 * 1000),
  });

  for (const event of events) {
    if (event.actionTaken === TRANSITION_ACTIONS.OVERTIME_CHARGE ||
        (event.actionTaken === TRANSITION_ACTIONS.GRACE_PERIOD &&
         event.graceExpiry && new Date(event.graceExpiry) <= currentTime)) {
      const multiplier = await getOvertimeMultiplier(event.toRuleId);
      return multiplier;
    }
  }

  return 1.0;
}

async function processAllTransitionsInWindow(fromDate, toDate) {
  const transitions = await scheduler.checkForTransitions(fromDate, toDate);
  const results = [];

  for (const transition of transitions) {
    const result = await handleTransition(transition);
    results.push(result);
  }

  const overtimeResults = await processPendingTransitions(toDate);

  return {
    transitionsHandled: results.length,
    overtimeProcessed: overtimeResults.length,
    details: { transitions: results, overtime: overtimeResults },
  };
}

async function getTransitionNotifications(lotId = null) {
  const pendingEvents = await store.listTransitionEvents({
    fromTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  const notifications = [];
  const spaces = lotId ? await store.listSpaces({ lotId }) : await store.listSpaces();
  const spaceMap = new Map(spaces.map(s => [s.id, s]));

  for (const event of pendingEvents) {
    if (event.notified) continue;
    if (lotId && !spaceMap.has(event.spaceId)) continue;

    const session = await store.getSessionById(event.sessionId);
    if (!session) continue;

    const space = spaceMap.get(event.spaceId);
    notifications.push({
      eventId: event.id,
      spaceId: event.spaceId,
      spaceCode: space?.code,
      plateNo: session.plateNo,
      transitionTime: event.transitionTime,
      graceExpiry: event.graceExpiry,
      actionTaken: event.actionTaken,
      note: event.note,
    });
  }

  return notifications;
}

async function runTransitionCheck() {
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  return processAllTransitionsInWindow(now, nextHour);
}

module.exports = {
  TRANSITION_ACTIONS,
  handleTransition,
  handleSharedToExclusiveTransition,
  handleExclusiveToSharedTransition,
  processPendingTransitions,
  processAllTransitionsInWindow,
  isInGracePeriod,
  calculateOvertimeMultiplier,
  getTransitionNotifications,
  runTransitionCheck,
  getGracePeriodMinutes,
  getOvertimeMultiplier,
};
