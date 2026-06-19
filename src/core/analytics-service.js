'use strict';

const store = require('../data/store');
const scheduler = require('./ownership-scheduler');
const billingService = require('./billing-service');

function formatDate(date) {
  if (typeof date === 'string') return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function parseDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

async function calculateSpaceDailyUtilization(spaceId, statDate) {
  const dateStr = typeof statDate === 'string' ? statDate : formatDate(statDate);
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);

  const [sessions] = await store.getPool().query(
    `SELECT * FROM parking_sessions 
     WHERE space_id = ? AND status = 'FINISHED'
       AND exit_time >= ? AND enter_time <= ?
     ORDER BY enter_time`,
    [spaceId, dayStart, dayEnd]
  );

  const exclusiveMinutes = { total: 0, occupied: 0, sessions: 0 };
  const sharedMinutes = { total: 0, occupied: 0, sessions: 0 };

  const [segmentRows] = await store.getPool().query(
    `SELECT bs.*, tor.ownership_type 
     FROM billing_segments bs
     JOIN time_ownership_rules tor ON bs.rule_id = tor.id
     WHERE bs.session_id IN (SELECT id FROM parking_sessions WHERE space_id = ?)
       AND bs.segment_start >= ? AND bs.segment_end <= ?`,
    [spaceId, dayStart, dayEnd]
  );

  for (const seg of segmentRows) {
    const type = seg.ownership_type || 'SHARED';
    const minutes = seg.duration_min;
    if (type === 'EXCLUSIVE') {
      exclusiveMinutes.occupied += minutes;
    } else {
      sharedMinutes.occupied += minutes;
    }
  }

  for (const session of sessions) {
    const sessionSegments = segmentRows.filter(s => s.session_id === session.id);
    const hasExclusive = sessionSegments.some(s => s.ownership_type === 'EXCLUSIVE');
    const hasShared = sessionSegments.some(s => s.ownership_type === 'SHARED');

    if (hasExclusive) exclusiveMinutes.sessions += 1;
    if (hasShared) sharedMinutes.sessions += 1;
  }

  exclusiveMinutes.total = 24 * 60;
  sharedMinutes.total = 24 * 60;

  const results = [];

  results.push(await store.createUtilizationStat({
    spaceId,
    statDate: dateStr,
    ownershipType: 'EXCLUSIVE',
    totalMinutes: exclusiveMinutes.total,
    occupiedMinutes: exclusiveMinutes.occupied,
    utilizationRate: exclusiveMinutes.total > 0
      ? Math.round((exclusiveMinutes.occupied / exclusiveMinutes.total) * 10000) / 100
      : 0,
    sessionCount: exclusiveMinutes.sessions,
  }));

  results.push(await store.createUtilizationStat({
    spaceId,
    statDate: dateStr,
    ownershipType: 'SHARED',
    totalMinutes: sharedMinutes.total,
    occupiedMinutes: sharedMinutes.occupied,
    utilizationRate: sharedMinutes.total > 0
      ? Math.round((sharedMinutes.occupied / sharedMinutes.total) * 10000) / 100
      : 0,
    sessionCount: sharedMinutes.sessions,
  }));

  return {
    date: dateStr,
    spaceId,
    exclusive: exclusiveMinutes,
    shared: sharedMinutes,
    stats: results,
  };
}

async function calculateLotDailyUtilization(lotId, statDate) {
  const spaces = await store.listSpaces({ lotId });
  const results = [];

  for (const space of spaces) {
    const result = await calculateSpaceDailyUtilization(space.id, statDate);
    results.push(result);
  }

  const summary = results.reduce((acc, r) => {
    acc.exclusive.occupied += r.exclusive.occupied;
    acc.exclusive.sessions += r.exclusive.sessions;
    acc.shared.occupied += r.shared.occupied;
    acc.shared.sessions += r.shared.sessions;
    return acc;
  }, {
    exclusive: { total: 0, occupied: 0, sessions: 0 },
    shared: { total: 0, occupied: 0, sessions: 0 },
  });

  const totalSpaceMinutes = spaces.length * 24 * 60;
  summary.exclusive.total = totalSpaceMinutes;
  summary.shared.total = totalSpaceMinutes;

  return {
    lotId,
    date: formatDate(statDate),
    totalSpaces: spaces.length,
    details: results,
    summary: {
      exclusive: {
        ...summary.exclusive,
        utilizationRate: summary.exclusive.total > 0
          ? Math.round((summary.exclusive.occupied / summary.exclusive.total) * 10000) / 100
          : 0,
      },
      shared: {
        ...summary.shared,
        utilizationRate: summary.shared.total > 0
          ? Math.round((summary.shared.occupied / summary.shared.total) * 10000) / 100
          : 0,
      },
    },
  };
}

async function getSpaceUtilizationTrend(spaceId, fromDate, toDate) {
  const stats = await store.listUtilizationStats({
    spaceId,
    fromDate: formatDate(fromDate),
    toDate: formatDate(toDate),
  });

  const byDate = new Map();
  for (const stat of stats) {
    const key = stat.statDate;
    if (!byDate.has(key)) byDate.set(key, {});
    byDate.get(key)[stat.ownershipType] = stat;
  }

  const trend = [];
  const start = parseDate(fromDate);
  const end = parseDate(toDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d);
    const dayStats = byDate.get(dateStr) || {};
    trend.push({
      date: dateStr,
      exclusive: dayStats.EXCLUSIVE || null,
      shared: dayStats.SHARED || null,
    });
  }

  return trend;
}

async function getLotUtilizationReport(lotId, fromDate, toDate) {
  const spaces = await store.listSpaces({ lotId });
  const spaceIds = spaces.map(s => s.id);

  const summary = await store.getUtilizationSummary({
    fromDate: formatDate(fromDate),
    toDate: formatDate(toDate),
  });

  const spaceReports = [];
  for (const spaceId of spaceIds) {
    const spaceSummary = await store.getUtilizationSummary({
      spaceId,
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate),
    });

    const space = spaces.find(s => s.id === spaceId);
    spaceReports.push({
      spaceId,
      spaceCode: space?.code,
      summary: spaceSummary,
    });
  }

  return {
    lotId,
    period: { from: formatDate(fromDate), to: formatDate(toDate) },
    totalSpaces: spaces.length,
    overall: summary,
    bySpace: spaceReports,
  };
}

async function getOptimizationRecommendations(lotId, fromDate, toDate) {
  const report = await getLotUtilizationReport(lotId, fromDate, toDate);
  const recommendations = [];

  const totalDays = Math.ceil((parseDate(toDate) - parseDate(fromDate)) / (1000 * 60 * 60 * 24)) + 1;

  for (const spaceReport of report.bySpace) {
    const exclusiveStat = spaceReport.summary.find(s => s.ownership_type === 'EXCLUSIVE');
    const sharedStat = spaceReport.summary.find(s => s.ownership_type === 'SHARED');
    const overall = spaceReport.summary.find(s => s.ownership_type === null);

    if (!overall) continue;

    const avgUtilization = overall.avg_utilization_rate || 0;
    const exclusiveUtil = exclusiveStat?.avg_utilization_rate || 0;
    const sharedUtil = sharedStat?.avg_utilization_rate || 0;

    if (exclusiveUtil < 30 && sharedUtil > 70) {
      recommendations.push({
        type: 'INCREASE_SHARED',
        spaceId: spaceReport.spaceId,
        spaceCode: spaceReport.spaceCode,
        currentExclusive: exclusiveUtil,
        currentShared: sharedUtil,
        suggestion: '该车位专属时段利用率过低，建议减少专属时段，增加共享时段',
        expectedImprovement: `预计可提升整体利用率 ${Math.round((sharedUtil - exclusiveUtil) / 2)}%`,
      });
    }

    if (exclusiveUtil > 85 && sharedUtil > 85) {
      recommendations.push({
        type: 'HIGH_DEMAND',
        spaceId: spaceReport.spaceId,
        spaceCode: spaceReport.spaceCode,
        currentExclusive: exclusiveUtil,
        currentShared: sharedUtil,
        suggestion: '该车位需求旺盛，建议考虑调整费率或增加同类型车位',
        expectedImprovement: '可考虑提高高峰时段费率',
      });
    }

    if (avgUtilization < 20) {
      recommendations.push({
        type: 'LOW_UTILIZATION',
        spaceId: spaceReport.spaceId,
        spaceCode: spaceReport.spaceCode,
        avgUtilization,
        suggestion: '该车位整体利用率过低，建议重新评估规则配置',
        expectedImprovement: '可尝试降低费率或扩大开放范围',
      });
    }
  }

  const overallAvg = report.overall.find(s => s.ownership_type === null)?.avg_utilization_rate || 0;

  return {
    lotId,
    period: { from: formatDate(fromDate), to: formatDate(toDate) },
    overallUtilization: overallAvg,
    totalDays,
    recommendations,
    count: recommendations.length,
  };
}

async function getOwnershipEfficiencyReport(orgId, fromDate, toDate) {
  const spaces = await store.listSpaces();
  const orgRules = await store.listOwnershipRules({ orgId, status: 'ACTIVE' });
  const ruleIds = orgRules.map(r => r.id);

  let orgSpaceIds = [];
  if (ruleIds.length > 0) {
    const [bindings] = await store.getPool().query(
      'SELECT DISTINCT space_id FROM space_rule_bindings WHERE rule_id IN (?)',
      [ruleIds]
    );
    orgSpaceIds = bindings.map(b => b.space_id);
  }

  const reports = [];
  for (const spaceId of orgSpaceIds) {
    const stats = await store.listUtilizationStats({
      spaceId,
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate),
      ownershipType: 'EXCLUSIVE',
    });

    const space = spaces.find(s => s.id === spaceId);
    const totalOccupied = stats.reduce((sum, s) => sum + s.occupiedMinutes, 0);
    const totalPossible = stats.length * 24 * 60;
    const avgUtilization = totalPossible > 0 ? Math.round((totalOccupied / totalPossible) * 10000) / 100 : 0;
    const totalSessions = stats.reduce((sum, s) => sum + s.sessionCount, 0);

    reports.push({
      spaceId,
      spaceCode: space?.code,
      totalDays: stats.length,
      totalOccupiedMinutes: totalOccupied,
      totalPossibleMinutes: totalPossible,
      avgUtilization,
      totalSessions,
    });
  }

  const totalOccupied = reports.reduce((sum, r) => sum + r.totalOccupiedMinutes, 0);
  const totalPossible = reports.reduce((sum, r) => sum + r.totalPossibleMinutes, 0);
  const overallAvg = totalPossible > 0 ? Math.round((totalOccupied / totalPossible) * 10000) / 100 : 0;

  return {
    orgId,
    period: { from: formatDate(fromDate), to: formatDate(toDate) },
    totalSpaces: reports.length,
    totalOccupiedMinutes: totalOccupied,
    totalPossibleMinutes: totalPossible,
    overallAvgUtilization: overallAvg,
    totalSessions: reports.reduce((sum, r) => sum + r.totalSessions, 0),
    bySpace: reports,
  };
}

async function runDailyAnalytics(date = new Date()) {
  const yesterday = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  const lots = await store.listLots();
  const results = [];

  for (const lot of lots) {
    const result = await calculateLotDailyUtilization(lot.id, yesterday);
    results.push(result);
  }

  return {
    date: formatDate(yesterday),
    lotsProcessed: results.length,
    results,
  };
}

module.exports = {
  calculateSpaceDailyUtilization,
  calculateLotDailyUtilization,
  getSpaceUtilizationTrend,
  getLotUtilizationReport,
  getOptimizationRecommendations,
  getOwnershipEfficiencyReport,
  runDailyAnalytics,
};
