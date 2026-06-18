'use strict';

const store = require('../data/store');

const OWNERSHIP_TYPES = {
  EXCLUSIVE: 'EXCLUSIVE',
  SHARED: 'SHARED',
  MAINTENANCE: 'MAINTENANCE',
};

function parseTimeStr(timeStr) {
  const [hours, minutes, seconds = 0] = timeStr.split(':').map(Number);
  return { hours, minutes, seconds };
}

function getDayOfWeek(date = new Date()) {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function isTimeInRange(currentTime, startTime, endTime) {
  const current = currentTime.hours * 3600 + currentTime.minutes * 60 + currentTime.seconds;
  const start = startTime.hours * 3600 + startTime.minutes * 60 + startTime.seconds;
  const end = endTime.hours * 3600 + endTime.minutes * 60 + endTime.seconds;

  if (start < end) {
    return current >= start && current < end;
  } else {
    return current >= start || current < end;
  }
}

function minutesUntilTime(currentTime, targetTime, isNextDay = false) {
  let current = currentTime.hours * 60 + currentTime.minutes + currentTime.seconds / 60;
  let target = targetTime.hours * 60 + targetTime.minutes + targetTime.seconds / 60;

  if (isNextDay) {
    target += 24 * 60;
  } else if (target <= current) {
    target += 24 * 60;
  }

  return Math.max(0, target - current);
}

function isRuleApplicableForDate(rule, date = new Date()) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const ruleDate = new Date(dateStr);

  if (rule.effectiveDate && ruleDate < new Date(rule.effectiveDate)) return false;
  if (rule.expiryDate && ruleDate > new Date(rule.expiryDate)) return false;

  const applicableDays = rule.applicableDays.split(',').map(Number);
  const dayOfWeek = getDayOfWeek(ruleDate);

  if (!applicableDays.includes(dayOfWeek)) return false;

  return true;
}

async function isDateHoliday(date = new Date()) {
  return store.isHoliday(date);
}

async function doesRuleMatchDayType(rule, date = new Date()) {
  const isHol = await isDateHoliday(date);
  if (isHol) {
    return rule.includeHolidays;
  }
  return true;
}

async function findApplicableRuleForSpace(spaceId, date = new Date()) {
  const bindingsWithRules = await store.getBindingsForSpace(spaceId, date);

  if (bindingsWithRules.length === 0) {
    return null;
  }

  const currentTime = {
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
  };

  for (const { rule } of bindingsWithRules) {
    if (!isRuleApplicableForDate(rule, date)) continue;
    if (!(await doesRuleMatchDayType(rule, date))) continue;

    const startTime = parseTimeStr(rule.timeStart);
    const endTime = parseTimeStr(rule.timeEnd);

    if (isTimeInRange(currentTime, startTime, endTime)) {
      return rule;
    }
  }

  return null;
}

async function findApplicableRulesForSpaces(spaceIds, date = new Date()) {
  const bindingsMap = await store.getBindingsForSpaces(spaceIds, date);
  const currentTime = {
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
  };

  const result = new Map();

  for (const spaceId of spaceIds) {
    const bindings = bindingsMap.get(spaceId) || [];
    let matchedRule = null;

    for (const { rule } of bindings) {
      if (!isRuleApplicableForDate(rule, date)) continue;
      if (!(await doesRuleMatchDayType(rule, date))) continue;

      const startTime = parseTimeStr(rule.timeStart);
      const endTime = parseTimeStr(rule.timeEnd);

      if (isTimeInRange(currentTime, startTime, endTime)) {
        matchedRule = rule;
        break;
      }
    }

    result.set(spaceId, matchedRule);
  }

  return result;
}

async function findNextTransitionForSpace(spaceId, fromDate = new Date()) {
  const bindingsWithRules = await store.getBindingsForSpace(spaceId, fromDate);

  if (bindingsWithRules.length === 0) {
    return null;
  }

  const currentTime = {
    hours: fromDate.getHours(),
    minutes: fromDate.getMinutes(),
    seconds: fromDate.getSeconds(),
  };

  let minMinutes = Infinity;
  let nextRule = null;
  let nextTransitionTime = null;

  const checkDates = [
    new Date(fromDate),
    new Date(fromDate.getTime() + 24 * 60 * 60 * 1000),
  ];

  for (let dayOffset = 0; dayOffset < checkDates.length; dayOffset++) {
    const checkDate = checkDates[dayOffset];
    const isNextDay = dayOffset > 0;

    for (const { rule } of bindingsWithRules) {
      if (!isRuleApplicableForDate(rule, checkDate)) continue;
      if (!(await doesRuleMatchDayType(rule, checkDate))) continue;

      const startTime = parseTimeStr(rule.timeStart);
      const endTime = parseTimeStr(rule.timeEnd);
      const checkTime = isNextDay ? { hours: 0, minutes: 0, seconds: 0 } : currentTime;

      const minToStart = minutesUntilTime(checkTime, startTime, isNextDay);
      const minToEnd = minutesUntilTime(checkTime, endTime, isNextDay);

      if (minToStart > 0 && minToStart < minMinutes) {
        minMinutes = minToStart;
        nextRule = rule;
        const transition = new Date(checkDate);
        transition.setHours(startTime.hours, startTime.minutes, startTime.seconds, 0);
        if (isNextDay && minToStart < 24 * 60) {
          transition.setDate(transition.getDate() + 1);
        }
        nextTransitionTime = transition;
      }

      if (minToEnd > 0 && minToEnd < minMinutes) {
        minMinutes = minToEnd;
        nextRule = null;
        const transition = new Date(checkDate);
        transition.setHours(endTime.hours, endTime.minutes, endTime.seconds, 0);
        if (isNextDay && minToEnd < 24 * 60) {
          transition.setDate(transition.getDate() + 1);
        }
        nextTransitionTime = transition;
      }
    }
  }

  if (nextTransitionTime) {
    return {
      transitionTime: nextTransitionTime,
      minutesUntil: Math.round(minMinutes),
      nextRule,
    };
  }

  return null;
}

async function getSpaceOwnership(spaceId, date = new Date()) {
  const rule = await findApplicableRuleForSpace(spaceId, date);
  const nextTransition = await findNextTransitionForSpace(spaceId, date);

  if (!rule) {
    return {
      spaceId,
      ownershipType: OWNERSHIP_TYPES.SHARED,
      orgId: null,
      ruleId: null,
      available: true,
      nextTransition: nextTransition?.transitionTime || null,
      nextRuleId: nextTransition?.nextRule?.id || null,
      isExclusive: false,
    };
  }

  return {
    spaceId,
    ownershipType: rule.ownershipType,
    orgId: rule.orgId,
    ruleId: rule.id,
    available: rule.ownershipType !== OWNERSHIP_TYPES.MAINTENANCE,
    isExclusive: rule.ownershipType === OWNERSHIP_TYPES.EXCLUSIVE,
    nextTransition: nextTransition?.transitionTime || null,
    nextRuleId: nextTransition?.nextRule?.id || null,
    ratePlanId: rule.ratePlanId,
    rule,
  };
}

async function getAllSpacesOwnership(lotId = null, date = new Date()) {
  const filter = {};
  if (lotId !== null) filter.lotId = lotId;
  const spaces = await store.listSpaces(filter);
  const spaceIds = spaces.map(s => s.id);

  const rulesMap = await findApplicableRulesForSpaces(spaceIds, date);
  const snapshots = [];

  for (const space of spaces) {
    const rule = rulesMap.get(space.id);
    const nextTransition = await findNextTransitionForSpace(space.id, date);

    const ownership = rule ? rule.ownershipType : OWNERSHIP_TYPES.SHARED;
    const available = space.status === 'FREE' && ownership !== OWNERSHIP_TYPES.MAINTENANCE;

    snapshots.push({
      spaceId: space.id,
      currentRuleId: rule?.id || null,
      ownershipType: ownership,
      orgId: rule?.orgId || null,
      available,
      nextTransition: nextTransition?.transitionTime || null,
      nextRuleId: nextTransition?.nextRule?.id || null,
    });
  }

  return snapshots;
}

async function refreshAllSnapshots(lotId = null) {
  const now = new Date();
  const snapshots = await getAllSpacesOwnership(lotId, now);
  await store.batchUpsertSnapshots(snapshots);
  return snapshots;
}

async function checkForTransitions(fromDate = new Date(), toDate = null) {
  const endTime = toDate || new Date(fromDate.getTime() + 60 * 1000);
  const spaces = await store.listSpaces();
  const transitions = [];

  for (const space of spaces) {
    const currentOwnership = await getSpaceOwnership(space.id, fromDate);
    const futureOwnership = await getSpaceOwnership(space.id, endTime);

    if (currentOwnership.ruleId !== futureOwnership.ruleId) {
      const nextTransition = await findNextTransitionForSpace(space.id, fromDate);
      if (nextTransition && nextTransition.transitionTime <= endTime) {
        transitions.push({
          spaceId: space.id,
          fromRuleId: currentOwnership.ruleId,
          toRuleId: futureOwnership.ruleId,
          transitionTime: nextTransition.transitionTime,
          fromOwnership: currentOwnership.ownershipType,
          toOwnership: futureOwnership.ownershipType,
          fromOrgId: currentOwnership.orgId,
          toOrgId: futureOwnership.orgId,
        });
      }
    }
  }

  return transitions;
}

async function canVehicleEnterSpace(spaceId, plateNo, date = new Date()) {
  const ownership = await getSpaceOwnership(spaceId, date);

  if (!ownership.available) {
    return { allowed: false, reason: 'SPACE_UNAVAILABLE', ownership };
  }

  if (ownership.isExclusive && ownership.orgId) {
    const isWhitelisted = await store.isPlateInWhitelist(plateNo, ownership.orgId, date);
    if (!isWhitelisted) {
      return { allowed: false, reason: 'NOT_IN_WHITELIST', ownership };
    }
    return { allowed: true, reason: 'WHITELISTED', ownership, isExclusive: true };
  }

  return { allowed: true, reason: 'SHARED_SPACE', ownership, isExclusive: false };
}

async function findAvailableSpace(lotId, plateNo, date = new Date()) {
  const ownerships = await getAllSpacesOwnership(lotId, date);

  for (const ownership of ownerships) {
    if (!ownership.available) continue;

    const check = await canVehicleEnterSpace(ownership.spaceId, plateNo, date);
    if (check.allowed) {
      return { spaceId: ownership.spaceId, ...check };
    }
  }

  return null;
}

module.exports = {
  OWNERSHIP_TYPES,
  parseTimeStr,
  getDayOfWeek,
  isTimeInRange,
  isRuleApplicableForDate,
  isDateHoliday,
  doesRuleMatchDayType,
  findApplicableRuleForSpace,
  findApplicableRulesForSpaces,
  findNextTransitionForSpace,
  getSpaceOwnership,
  getAllSpacesOwnership,
  refreshAllSnapshots,
  checkForTransitions,
  canVehicleEnterSpace,
  findAvailableSpace,
};
