'use strict';

const store = require('../data/store');
const scheduler = require('./ownership-scheduler');
const billingService = require('./billing-service');

const TRANSACTION_TYPES = {
  SHARED_PARKING: 'SHARED_PARKING',
  EXCLUSIVE_OVERTIME: 'EXCLUSIVE_OVERTIME',
  GRACE_OVERTIME: 'GRACE_OVERTIME',
};

async function getOrgShareRatio(orgId) {
  if (!orgId) return 70.00;
  const org = await store.getOrganizationById(orgId);
  return org?.shareRatio || 70.00;
}

async function calculateRevenueShare(sessionId) {
  const session = await store.getSessionById(sessionId);
  if (!session || session.status !== 'FINISHED') {
    return null;
  }

  const segments = await store.getSegmentsForSession(sessionId);
  if (segments.length === 0) {
    const result = await billingService.saveBillingSegments(sessionId);
    segments.push(...result.segments);
  }

  const ruleGroupedSegments = new Map();
  for (const segment of segments) {
    const key = segment.ruleId || 'default';
    if (!ruleGroupedSegments.has(key)) {
      ruleGroupedSegments.set(key, []);
    }
    ruleGroupedSegments.get(key).push(segment);
  }

  const transactions = [];
  let totalCents = 0;
  let totalOrgShare = 0;
  let totalOperatorShare = 0;

  for (const [ruleId, segs] of ruleGroupedSegments) {
    const rule = ruleId !== 'default' ? await store.getOwnershipRuleById(ruleId) : null;
    const orgId = rule?.orgId || null;
    const shareRatio = await getOrgShareRatio(orgId);

    const segmentTotal = segs.reduce((sum, s) => sum + s.amountCents, 0);
    const hasOvertime = segs.some(s => s.isOvertime);

    let transactionType = TRANSACTION_TYPES.SHARED_PARKING;
    if (rule?.ownershipType === scheduler.OWNERSHIP_TYPES.EXCLUSIVE) {
      transactionType = hasOvertime ? TRANSACTION_TYPES.EXCLUSIVE_OVERTIME : TRANSACTION_TYPES.SHARED_PARKING;
    }
    if (segs.some(s => s.isOvertime)) {
      transactionType = TRANSACTION_TYPES.GRACE_OVERTIME;
    }

    const orgShare = Math.round(segmentTotal * shareRatio / 100);
    const operatorShare = segmentTotal - orgShare;

    totalCents += segmentTotal;
    totalOrgShare += orgShare;
    totalOperatorShare += operatorShare;

    transactions.push({
      sessionId,
      spaceId: session.spaceId,
      ruleId: ruleId === 'default' ? null : ruleId,
      orgId,
      transactionType,
      totalAmountCents: segmentTotal,
      orgShareCents: orgShare,
      operatorShareCents: operatorShare,
      shareRatio,
      segments: segs,
    });
  }

  return {
    sessionId,
    transactions,
    totalCents,
    totalOrgShare,
    totalOperatorShare,
  };
}

async function createSharedTransactionForSession(sessionId) {
  const revenue = await calculateRevenueShare(sessionId);
  if (!revenue) return null;

  const results = [];
  for (const tx of revenue.transactions) {
    if (tx.totalAmountCents <= 0) continue;

    const existing = await store.listSharedTransactions({ sessionId, ruleId: tx.ruleId });
    if (existing.length > 0) continue;

    const result = await store.createSharedTransaction({
      sessionId: tx.sessionId,
      spaceId: tx.spaceId,
      ruleId: tx.ruleId,
      orgId: tx.orgId,
      transactionType: tx.transactionType,
      totalAmountCents: tx.totalAmountCents,
      orgShareCents: tx.orgShareCents,
      operatorShareCents: tx.operatorShareCents,
      shareRatio: tx.shareRatio,
      settled: false,
    });
    results.push(result);
  }

  return {
    transactions: results,
    totalCents: revenue.totalCents,
    totalOrgShare: revenue.totalOrgShare,
    totalOperatorShare: revenue.totalOperatorShare,
  };
}

async function processSessionForRevenue(sessionId) {
  const session = await store.getSessionById(sessionId);
  if (!session || session.status !== 'FINISHED') {
    return { success: false, reason: 'SESSION_NOT_FINISHED' };
  }

  await billingService.saveBillingSegments(sessionId);
  const result = await createSharedTransactionForSession(sessionId);

  return { success: true, ...result };
}

async function batchProcessSessionsForRevenue(fromDate, toDate) {
  const [sessions] = await store.getPool().query(
    `SELECT * FROM parking_sessions 
     WHERE status = 'FINISHED' AND exit_time >= ? AND exit_time <= ?
     ORDER BY exit_time`,
    [fromDate, toDate]
  );

  const results = [];
  for (const session of sessions) {
    try {
      const result = await processSessionForRevenue(session.id);
      if (result.success) {
        results.push(result);
      }
    } catch (e) {
      console.error(`处理会话 ${session.id} 收益失败:`, e);
    }
  }

  const totalCents = results.reduce((sum, r) => sum + (r.totalCents || 0), 0);
  const totalOrgShare = results.reduce((sum, r) => sum + (r.totalOrgShare || 0), 0);
  const totalOperatorShare = results.reduce((sum, r) => sum + (r.totalOperatorShare || 0), 0);

  return {
    processed: results.length,
    totalSessions: sessions.length,
    totalCents,
    totalOrgShare,
    totalOperatorShare,
    details: results,
  };
}

async function getRevenueSummary({ orgId, fromDate, toDate, settled } = {}) {
  const transactions = await store.listSharedTransactions({ orgId, fromDate, toDate, settled });

  const summary = {
    totalTransactions: transactions.length,
    totalAmountCents: 0,
    totalOrgShareCents: 0,
    totalOperatorShareCents: 0,
    byType: {},
    byOrg: {},
  };

  for (const tx of transactions) {
    summary.totalAmountCents += tx.totalAmountCents;
    summary.totalOrgShareCents += tx.orgShareCents;
    summary.totalOperatorShareCents += tx.operatorShareCents;

    if (!summary.byType[tx.transactionType]) {
      summary.byType[tx.transactionType] = { count: 0, amount: 0 };
    }
    summary.byType[tx.transactionType].count += 1;
    summary.byType[tx.transactionType].amount += tx.totalAmountCents;

    const orgKey = tx.orgId || 'no_org';
    if (!summary.byOrg[orgKey]) {
      summary.byOrg[orgKey] = { count: 0, amount: 0, orgShare: 0, operatorShare: 0 };
    }
    summary.byOrg[orgKey].count += 1;
    summary.byOrg[orgKey].amount += tx.totalAmountCents;
    summary.byOrg[orgKey].orgShare += tx.orgShareCents;
    summary.byOrg[orgKey].operatorShare += tx.operatorShareCents;
  }

  return summary;
}

async function getOrgRevenueReport(orgId, fromDate, toDate) {
  const org = await store.getOrganizationById(orgId);
  if (!org) return null;

  const transactions = await store.listSharedTransactions({
    orgId,
    fromDate,
    toDate,
  });

  const settledTx = transactions.filter(tx => tx.settled);
  const unsettledTx = transactions.filter(tx => !tx.settled);

  const report = {
    orgId,
    orgName: org.name,
    shareRatio: org.shareRatio,
    period: { fromDate, toDate },
    totalTransactions: transactions.length,
    totalAmountCents: transactions.reduce((sum, tx) => sum + tx.totalAmountCents, 0),
    totalOrgShareCents: transactions.reduce((sum, tx) => sum + tx.orgShareCents, 0),
    totalOperatorShareCents: transactions.reduce((sum, tx) => sum + tx.operatorShareCents, 0),
    settled: {
      count: settledTx.length,
      amountCents: settledTx.reduce((sum, tx) => sum + tx.totalAmountCents, 0),
      orgShareCents: settledTx.reduce((sum, tx) => sum + tx.orgShareCents, 0),
    },
    unsettled: {
      count: unsettledTx.length,
      amountCents: unsettledTx.reduce((sum, tx) => sum + tx.totalAmountCents, 0),
      orgShareCents: unsettledTx.reduce((sum, tx) => sum + tx.orgShareCents, 0),
    },
    byDate: {},
  };

  for (const tx of transactions) {
    const date = tx.createdAt.slice(0, 10);
    if (!report.byDate[date]) {
      report.byDate[date] = { count: 0, amount: 0, orgShare: 0 };
    }
    report.byDate[date].count += 1;
    report.byDate[date].amount += tx.totalAmountCents;
    report.byDate[date].orgShare += tx.orgShareCents;
  }

  return report;
}

async function settleOrgTransactions(orgId, settlementDate) {
  const unsettled = await store.listSharedTransactions({ orgId, settled: false });
  const txIds = unsettled.map(tx => tx.id);

  if (txIds.length === 0) {
    return { settled: 0, totalAmount: 0, orgShare: 0 };
  }

  const count = await store.settleTransactions(txIds, settlementDate);

  const totalAmount = unsettled.reduce((sum, tx) => sum + tx.totalAmountCents, 0);
  const orgShare = unsettled.reduce((sum, tx) => sum + tx.orgShareCents, 0);

  return {
    settled: count,
    settlementDate,
    totalAmountCents: totalAmount,
    orgShareCents: orgShare,
    operatorShareCents: totalAmount - orgShare,
  };
}

async function getSettlementReport(fromDate, toDate) {
  const orgs = await store.listOrganizations();
  const reports = [];

  for (const org of orgs) {
    const report = await getOrgRevenueReport(org.id, fromDate, toDate);
    if (report) {
      reports.push(report);
    }
  }

  const totalAmount = reports.reduce((sum, r) => sum + r.totalAmountCents, 0);
  const totalOrgShare = reports.reduce((sum, r) => sum + r.totalOrgShareCents, 0);
  const totalOperatorShare = reports.reduce((sum, r) => sum + r.totalOperatorShareCents, 0);

  return {
    period: { fromDate, toDate },
    orgs: reports,
    totalAmountCents: totalAmount,
    totalOrgShareCents: totalOrgShare,
    totalOperatorShareCents: totalOperatorShare,
  };
}

module.exports = {
  TRANSACTION_TYPES,
  getOrgShareRatio,
  calculateRevenueShare,
  createSharedTransactionForSession,
  processSessionForRevenue,
  batchProcessSessionsForRevenue,
  getRevenueSummary,
  getOrgRevenueReport,
  settleOrgTransactions,
  getSettlementReport,
};
