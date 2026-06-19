'use strict';

const { getPool, ensureSchema, rebuildSchema, waitForDb, close } = require('./src/db');
const { seed } = require('./src/seed');

async function run() {
  await waitForDb();
  await ensureSchema();
  getPool();
  await rebuildSchema();
  await seed();
  console.log('重建表结构和种子数据完成');
  await close();
}

run().catch(e => { console.error(e); process.exit(1); });
