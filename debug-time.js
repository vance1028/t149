'use strict';

const { getPool, ensureSchema, resetAll, waitForDb, close } = require('./src/db');
const { seed } = require('./src/seed');
const store = require('./src/data/store');
const accessController = require('./src/core/access-controller');
const scheduler = require('./src/core/ownership-scheduler');

async function run() {
  await waitForDb();
  await ensureSchema();
  getPool();
  await resetAll();
  await seed();

  const lots = await store.listLots();
  const lot1 = lots.find(l => l.code === 'PL-CG-001');
  const spaces = await store.listSpaces({ lotId: lot1.id });
  const space1 = spaces[0];

  const enterTime = new Date('2026-06-18T10:00:00');
  const exitTime = new Date('2026-06-18T12:00:00');

  console.log('===== 输入时间（北京时间） =====');
  console.log('enterTime (JS Date):', enterTime);
  console.log('enterTime (ISO):', enterTime.toISOString());
  console.log('enterTime (本地字符串):', enterTime.toISOString().slice(0,19).replace('T',' '));
  console.log('exitTime (JS Date):', exitTime);
  console.log('exitTime (ISO):', exitTime.toISOString());

  // 入场
  const enterResult = await accessController.processVehicleEntry(lot1.id, '时间测试', null, enterTime);
  const sessionId = enterResult.session.id;
  const session = await store.getSessionById(sessionId);

  console.log('\n===== 数据库中 session.enter_time =====');
  console.log('session.enterTime (mapped):', session.enterTime);
  console.log('session.enterTime (typeof):', typeof session.enterTime);
  console.log('new Date(session.enterTime):', new Date(session.enterTime));
  console.log('与原始enterTime差值（分钟）:', (new Date(session.enterTime) - enterTime)/60000);

  // 检查 buildTimeSegments 调用
  console.log('\n===== 直接调用计费模块 buildTimeSegments =====');
  const billingService = require('./src/core/billing-service');

  const startTime = new Date(session.enterTime);
  const endTime = exitTime;
  console.log('startTime (用于计费):', startTime);
  console.log('endTime (用于计费):', endTime);
  console.log('start-end 差值（分钟）:', (endTime - startTime)/60000);

  const segments = await billingService.buildTimeSegments(space1.id, startTime, endTime);
  console.log('buildTimeSegments 结果 segments:', JSON.stringify(segments, null, 2));

  const calculated = await billingService.calculateBillingSegments(sessionId, exitTime);
  console.log('\ncalculateBillingSegments 结果:');
  console.log('  totalCents:', calculated.totalCents);
  calculated.segments.forEach((s,i) => {
    console.log(`  seg${i}: duration=${s.durationMin}min, amount=${s.amountCents}, start=${s.segmentStart}, end=${s.segmentEnd}`);
  });

  await close();
}

run().catch(e => { console.error(e); process.exit(1); });
