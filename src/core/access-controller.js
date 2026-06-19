'use strict';

const store = require('../data/store');
const scheduler = require('./ownership-scheduler');
const billingService = require('./billing-service');

async function validateVehicleEntry(lotId, plateNo, spaceId = null, entryTime = new Date()) {
  const lot = await store.getLotById(lotId);
  if (!lot) {
    return { allowed: false, reason: 'LOT_NOT_FOUND' };
  }
  if (lot.status !== 'OPEN') {
    return { allowed: false, reason: 'LOT_CLOSED' };
  }

  const activeSessions = await store.listSessions({ plateNo, status: 'PARKED' });
  if (activeSessions.length > 0) {
    return { allowed: false, reason: 'VEHICLE_ALREADY_PARKED', sessionId: activeSessions[0].id };
  }

  let targetSpaceId = spaceId;
  let spaceCheck = null;

  if (targetSpaceId) {
    const space = await store.getSpaceById(targetSpaceId);
    if (!space) {
      return { allowed: false, reason: 'SPACE_NOT_FOUND' };
    }
    if (space.status !== 'FREE') {
      return { allowed: false, reason: 'SPACE_OCCUPIED' };
    }
    spaceCheck = await scheduler.canVehicleEnterSpace(targetSpaceId, plateNo, entryTime);
    if (!spaceCheck.allowed) {
      return { allowed: false, reason: spaceCheck.reason, details: spaceCheck };
    }
  } else {
    const available = await scheduler.findAvailableSpace(lotId, plateNo, entryTime);
    if (!available) {
      return { allowed: false, reason: 'NO_AVAILABLE_SPACE' };
    }
    targetSpaceId = available.spaceId;
    spaceCheck = available;
  }

  const ownership = await scheduler.getSpaceOwnership(targetSpaceId, entryTime);

  return {
    allowed: true,
    spaceId: targetSpaceId,
    ownership,
    isExclusive: spaceCheck?.isExclusive || false,
    enterRuleId: ownership.ruleId,
  };
}

async function processVehicleEntry(lotId, plateNo, spaceId = null, entryTime = null) {
  const actualEntryTime = entryTime || new Date();
  const validation = await validateVehicleEntry(lotId, plateNo, spaceId, actualEntryTime);

  if (!validation.allowed && validation.reason !== 'NO_AVAILABLE_SPACE') {
    return { success: false, ...validation };
  }

  const assignedSpaceId = validation.allowed ? validation.spaceId : null;
  const enterRuleId = validation.allowed ? validation.enterRuleId : null;

  const session = await store.createSession({
    lotId,
    plateNo,
    spaceId: assignedSpaceId,
    enterTime: actualEntryTime,
    enterRuleId,
    status: 'PARKED',
  });

  if (assignedSpaceId) {
    await store.updateSpace(assignedSpaceId, { status: 'OCCUPIED' });

    if (validation.ownership) {
      await store.upsertOwnershipSnapshot({
        spaceId: assignedSpaceId,
        currentRuleId: validation.ownership.ruleId,
        ownershipType: validation.ownership.ownershipType,
        orgId: validation.ownership.orgId,
        available: false,
        nextTransition: validation.ownership.nextTransition,
        nextRuleId: validation.ownership.nextRuleId,
      });
    }
  }

  return {
    success: true,
    session,
    ownership: validation.ownership || null,
    isExclusive: validation.isExclusive || false,
    note: validation.reason === 'NO_AVAILABLE_SPACE' ? '未分配车位' : undefined,
  };
}

async function processVehicleExit(sessionId, exitTime = null) {
  const session = await store.getSessionById(sessionId);
  if (!session) {
    return { success: false, reason: 'SESSION_NOT_FOUND' };
  }
  if (session.status !== 'PARKED') {
    return { success: false, reason: 'SESSION_ALREADY_FINISHED' };
  }

  const actualExitTime = exitTime || new Date();

  let segments = [];
  let totalCents = 0;

  try {
    const result = await billingService.recalculateSessionFee(sessionId, actualExitTime);
    segments = result.segments;
    totalCents = result.totalCents;
  } catch (e) {
    console.error('计费计算失败，使用默认值:', e);
    segments = [];
    totalCents = 0;
  }

  const updatedSession = await store.updateSession(sessionId, {
    exitTime: actualExitTime,
    feeCents: totalCents,
    status: 'FINISHED',
  });

  if (session.spaceId) {
    await store.updateSpace(session.spaceId, { status: 'FREE' });
    try {
      const ownership = await scheduler.getSpaceOwnership(session.spaceId, actualExitTime);
      if (ownership) {
        await store.upsertOwnershipSnapshot({
          spaceId: session.spaceId,
          currentRuleId: ownership.ruleId,
          ownershipType: ownership.ownershipType,
          orgId: ownership.orgId,
          available: true,
          nextTransition: ownership.nextTransition,
          nextRuleId: ownership.nextRuleId,
        });
      }
    } catch (e) {
      console.error('更新快照失败:', e);
    }
  }

  return {
    success: true,
    session: updatedSession,
    segments,
    totalCents,
  };
}

async function getEntryRecommendations(lotId, plateNo, entryTime = new Date()) {
  const ownership = await scheduler.getAllSpacesOwnership(lotId, entryTime);
  const spaces = await store.listSpaces({ lotId });
  const spaceMap = new Map(spaces.map(s => [s.id, s]));

  const recommendations = {
    exclusive: [],
    shared: [],
    unavailable: [],
  };

  for (const snap of ownership) {
    const space = spaceMap.get(snap.spaceId);
    if (!space) continue;

    const check = await scheduler.canVehicleEnterSpace(snap.spaceId, plateNo, entryTime);

    const info = {
      spaceId: snap.spaceId,
      spaceCode: space.code,
      spaceType: space.type,
      ownershipType: snap.ownershipType,
      orgId: snap.orgId,
      available: snap.available && check.allowed,
      nextTransition: snap.nextTransition,
    };

    if (!info.available) {
      recommendations.unavailable.push({ ...info, reason: check.reason });
    } else if (snap.ownershipType === scheduler.OWNERSHIP_TYPES.EXCLUSIVE && check.isExclusive) {
      recommendations.exclusive.push(info);
    } else {
      recommendations.shared.push(info);
    }
  }

  const best = recommendations.exclusive[0] || recommendations.shared[0];

  return {
    best,
    ...recommendations,
    totalAvailable: recommendations.exclusive.length + recommendations.shared.length,
    totalExclusive: recommendations.exclusive.length,
    totalShared: recommendations.shared.length,
  };
}

async function getLotRealtimeStatus(lotId, currentTime = new Date()) {
  const spaces = await store.listSpaces({ lotId });
  const snapshots = await scheduler.getAllSpacesOwnership(lotId, currentTime);
  const sessions = await store.listSessions({ lotId, status: 'PARKED' });

  const spaceMap = new Map(spaces.map(s => [s.id, s]));
  const sessionMap = new Map(sessions.map(s => [s.spaceId, s]));

  const status = {
    lotId,
    totalSpaces: spaces.length,
    byOwnership: {
      EXCLUSIVE: { total: 0, available: 0, occupied: 0 },
      SHARED: { total: 0, available: 0, occupied: 0 },
      MAINTENANCE: { total: 0, available: 0, occupied: 0 },
    },
    spaces: [],
  };

  for (const snap of snapshots) {
    const space = spaceMap.get(snap.spaceId);
    const session = sessionMap.get(snap.spaceId);
    const type = snap.ownershipType || 'SHARED';

    if (status.byOwnership[type]) {
      status.byOwnership[type].total += 1;
      if (snap.available && space?.status === 'FREE') {
        status.byOwnership[type].available += 1;
      } else {
        status.byOwnership[type].occupied += 1;
      }
    }

    status.spaces.push({
      spaceId: snap.spaceId,
      spaceCode: space?.code,
      ownershipType: type,
      orgId: snap.orgId,
      available: snap.available && space?.status === 'FREE',
      occupiedBy: session ? { plateNo: session.plateNo, sessionId: session.id, enterTime: session.enterTime } : null,
      nextTransition: snap.nextTransition,
    });
  }

  return status;
}

async function getVehicleParkingStatus(plateNo, currentTime = new Date()) {
  const sessions = await store.listSessions({ plateNo, status: 'PARKED' });
  if (sessions.length === 0) {
    return { isParked: false };
  }

  const session = sessions[0];
  const space = session.spaceId ? await store.getSpaceById(session.spaceId) : null;
  const ownership = space ? await scheduler.getSpaceOwnership(space.id, currentTime) : null;
  const billing = await billingService.getSessionBillingDetails(session.id);

  return {
    isParked: true,
    session,
    space,
    ownership,
    currentFee: billing?.totalCents || 0,
    segments: billing?.segments || [],
  };
}

module.exports = {
  validateVehicleEntry,
  processVehicleEntry,
  processVehicleExit,
  getEntryRecommendations,
  getLotRealtimeStatus,
  getVehicleParkingStatus,
};
