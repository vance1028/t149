'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { getPool, ensureSchema, rebuildSchema, waitForDb, close } = require('./src/db');
const { seed } = require('./src/seed');
const { createApp } = require('./src/app');
const express = require('express');
const request = require('supertest');

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

  const app = createApp();

  // 1. 登录获取 token
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'admin123' });
  const token = loginRes.body.data?.token || loginRes.body.token;
  log('登录', { status: loginRes.status, token: token ? 'OK' : 'NO', username: loginRes.body.data?.user?.name || loginRes.body.user?.username });

  // 2. 创建测试数据：2小时停车记录
  const lotsRes = await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`);
  const lots = lotsRes.body.data || lotsRes.body;
  const lot1 = lots.find(l => l.code === 'PL-CG-001');
  log('停车场ID', lot1.id);

  // 直接写数据库，插入一个 10:00~12:00 的停车记录
  const pool = getPool();
  const plateNo = 'HTTPA001';
  const enterTime = new Date('2026-06-18T10:00:00');
  const exitTime = new Date('2026-06-18T12:00:00');

  // 创建车辆
  const [veh] = await pool.query(
    'INSERT INTO vehicles (plate_no, owner_name, vehicle_type, is_member) VALUES (?, ?, ?, ?)',
    [plateNo, '测试车主A', 'SMALL', 0]
  );

  // 分配空闲车位
  const [freeSpaces] = await pool.query(
    'SELECT * FROM parking_spaces WHERE lot_id = ? AND status = ? ORDER BY id LIMIT 1',
    [lot1.id, 'FREE']
  );
  const spaceId = freeSpaces[0].id;

  // 创建已完成的 session（直接入库，再重新计算费用）
  const billingService = require('./src/core/billing-service');
  const store = require('./src/data/store');
  const accessController = require('./src/core/access-controller');

  // 用 accessController 走完整流程
  log('执行入场/出场流程...');
  const enter = await accessController.processVehicleEntry(lot1.id, plateNo, null, enterTime);
  const sessionId = enter.session.id;
  const exit = await accessController.processVehicleExit(sessionId, exitTime);
  log('出场结果', {
    status: exit.success ? 'OK' : 'FAIL',
    totalCents: exit.totalCents,
    totalYuan: (exit.totalCents / 100).toFixed(2),
    segments: exit.segments?.length
  });
  if (exit.segments && exit.segments.length) {
    log('首段明细', {
      min: exit.segments[0].durationMin,
      amountCents: exit.segments[0].amountCents,
      rate: exit.segments[0].rateCents
    });
  }

  // 3. 测试 日账单汇总
  const summaryRes = await request(app)
    .get(`/api/billing/summary/date/2026-06-18?lotId=${lot1.id}`)
    .set('Authorization', `Bearer ${token}`);
  log('【测试1】日账单汇总', {
    status: summaryRes.status,
    body: summaryRes.body
  });

  // 4. 先运行每日统计
  const runRes = await request(app)
    .post('/api/analytics/daily-run')
    .send({ fromDate: '2026-06-18', toDate: '2026-06-18' })
    .set('Authorization', `Bearer ${token}`);
  log('【测试2】手动触发每日统计', {
    status: runRes.status,
    body: runRes.body
  });

  // 5. 测试 停车场利用率报表
  const utilRes = await request(app)
    .get(`/api/analytics/lot/${lot1.id}/utilization?fromDate=2026-06-18&toDate=2026-06-18`)
    .set('Authorization', `Bearer ${token}`);
  log('【测试3】停车场利用率报表', {
    status: utilRes.status,
    totalSpaces: utilRes.body?.totalSpaces,
    overallCount: utilRes.body?.overall?.length,
    bySpaceCount: utilRes.body?.bySpace?.length,
    firstOverall: utilRes.body?.overall?.[0]
  });

  // 6. 测试 优化建议
  const optRes = await request(app)
    .get(`/api/analytics/lot/${lot1.id}/optimization?fromDate=2026-06-18&toDate=2026-06-18`)
    .set('Authorization', `Bearer ${token}`);
  log('【测试4】优化建议', {
    status: optRes.status,
    count: optRes.body?.count,
    overallUtilization: optRes.body?.overallUtilization,
    firstRec: optRes.body?.recommendations?.[0]
  });

  // 7. 测试 计费明细
  const detailRes = await request(app)
    .get(`/api/sessions/${sessionId}/billing`)
    .set('Authorization', `Bearer ${token}`);
  log('【测试5】计费明细', {
    status: detailRes.status,
    totalCents: detailRes.body?.totalCents,
    segmentsCount: detailRes.body?.segments?.length
  });

  // 8. 测试 收益分成
  const shareRes = await request(app)
    .get(`/api/revenue/share?fromDate=2026-06-18&toDate=2026-06-18`)
    .set('Authorization', `Bearer ${token}`);
  log('【测试6】收益分成', {
    status: shareRes.status,
    totalSessions: shareRes.body?.sessions?.length,
    totalCents: shareRes.body?.summary?.totalCents
  });

  log('\n✅ 所有 HTTP 接口测试完成');
  await close();
}

run().catch(e => { console.error('整体报错:', e); process.exit(1); });
