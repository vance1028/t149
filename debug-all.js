'use strict';

const { getPool, ensureSchema, resetAll, rebuildSchema, waitForDb, close } = require('./src/db');
const { seed } = require('./src/seed');
const store = require('./src/data/store');
const accessController = require('./src/core/access-controller');
const billingService = require('./src/core/billing-service');
const revenueService = require('./src/core/revenue-service');
const analyticsService = require('./src/core/analytics-service');

function log(title, data) {
  console.log('\n========== ' + title + ' ==========');
  if (data !== undefined) {
    if (typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  }
}

async function run() {
  await waitForDb();
  await ensureSchema();
  getPool();
  await rebuildSchema();
  await seed();

  log('初始化完成');

  const lots = await store.listLots();
  const lot1 = lots.find(l => l.code === 'PL-CG-001');
  log('停车场', { id: lot1.id, name: lot1.name });

  const spaces = await store.listSpaces({ lotId: lot1.id });
  log('车位数量', spaces.length);

  // ============ 测试1：入场出场计费 ============
  log('【测试1】计费：2小时停车费用');
  const plateNo = '测试A001';
  const enterTime = new Date('2026-06-18T10:00:00');
  const exitTime = new Date('2026-06-18T12:00:00');

  const enterResult = await accessController.processVehicleEntry(lot1.id, plateNo, null, enterTime);
  log('入场结果', {
    success: enterResult.success,
    sessionId: enterResult.session?.id,
    spaceId: enterResult.session?.spaceId,
    ownership: enterResult.ownership
  });

  const sessionId = enterResult.session.id;

  const exitResult = await accessController.processVehicleExit(sessionId, exitTime);
  log('出场结果', {
    success: exitResult.success,
    totalCents: exitResult.totalCents,
    status: exitResult.session?.status,
    segmentsCount: exitResult.segments?.length
  });

  // 查看时长
  if (exitResult.segments && exitResult.segments.length > 0) {
    const firstSeg = exitResult.segments[0];
    log('计费明细-首段', {
      segmentStart: firstSeg.segmentStart,
      segmentEnd: firstSeg.segmentEnd,
      durationMin: firstSeg.durationMin,
      rateCents: firstSeg.rateCents,
      amountCents: firstSeg.amountCents,
      note: firstSeg.note
    });
  }

  // 计算实际时长
  const expectedMin = (exitTime - enterTime) / 60000;
  const actualMin = exitResult.segments.reduce((s, x) => s + x.durationMin, 0);
  log('时长对比', {
    预期分钟: expectedMin,
    实际计费分钟: actualMin,
    差异: actualMin - expectedMin
  });
  log('金额对比', {
    出场返回totalCents: exitResult.totalCents,
    分段汇总金额: exitResult.segments.reduce((s, x) => s + x.amountCents, 0)
  });

  // ============ 测试2：金额一致性 ============
  log('【测试2】金额一致性检查');
  const sessionFromDB = await store.getSessionById(sessionId);
  const billingDetails = await billingService.getSessionBillingDetails(sessionId);
  const revenue = await revenueService.calculateRevenueShare(sessionId);

  log('金额来源对比', {
    '1.parking_sessions.feeCents': sessionFromDB.feeCents,
    '2.getSessionBillingDetails返回totalCents': billingDetails.totalCents,
    '3.segments汇总': billingDetails.segments.reduce((s, x) => s + x.amountCents, 0),
    '4.revenueService.totalCents': revenue?.totalCents
  });

  // ============ 测试3：日账单汇总 ============
  log('【测试3】日账单汇总接口');
  try {
    const summary = await billingService.getBillingSummaryByDate('2026-06-18', lot1.id);
    log('日账单结果', {
      date: summary.date,
      totalSessions: summary.totalSessions,
      totalCents: summary.totalCents,
      totalMinutes: summary.totalMinutes
    });
    log('日账单-正常');
  } catch (e) {
    log('日账单-报错', e.message);
    console.error(e);
  }

  // ============ 测试4：利用率统计 ============
  log('【测试4】每日统计 runDailyAnalytics');
  try {
    const runResult = await analyticsService.runDailyAnalytics(new Date('2026-06-19'));
    log('每日统计结果', {
      date: runResult.date,
      lotsProcessed: runResult.lotsProcessed,
      firstLotDetailsCount: runResult.results[0]?.details?.length || 0
    });
  } catch (e) {
    log('每日统计-报错', e.message);
    console.error(e);
  }

  // ============ 测试5：停车场利用率报表 ============
  log('【测试5】停车场利用率报表');
  try {
    const report = await analyticsService.getLotUtilizationReport(lot1.id, '2026-06-18', '2026-06-18');
    log('利用率报表', {
      lotId: report.lotId,
      totalSpaces: report.totalSpaces,
      overallLength: report.overall?.length,
      bySpaceLength: report.bySpace?.length
    });
    if (report.overall && report.overall.length > 0) {
      log('overall首项', report.overall[0]);
    }
  } catch (e) {
    log('利用率报表-报错', e.message);
    console.error(e);
  }

  // ============ 测试6：优化建议 ============
  log('【测试6】优化建议');
  try {
    const opt = await analyticsService.getOptimizationRecommendations(lot1.id, '2026-06-18', '2026-06-18');
    log('优化建议', {
      count: opt.count,
      overallUtilization: opt.overallUtilization,
      recsLength: opt.recommendations?.length
    });
  } catch (e) {
    log('优化建议-报错', e.message);
    console.error(e);
  }

  log('\n========== 所有测试完成 ==========');
  await close();
}

run().catch(e => {
  console.error('整体报错:', e);
  process.exit(1);
});
