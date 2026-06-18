'use strict';

const { getPool } = require('../db');
const { hashPassword } = require('../utils/password');

/**
 * 数据仓储层：所有 SQL 集中在这里，路由层只调用这些 async 方法。
 * 对外返回 camelCase 字段对象。
 */

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, name: r.name, role: r.role,
    status: r.status, createdAt: r.created_at,
  };
}
function mapUserWithHash(r) {
  if (!r) return null;
  return { ...mapUser(r), passwordHash: r.password_hash };
}
function mapLot(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, name: r.name, district: r.district, address: r.address,
    totalSpaces: r.total_spaces, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapSpace(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, code: r.code, type: r.type, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapVehicle(r) {
  if (!r) return null;
  return {
    id: r.id, plateNo: r.plate_no, ownerName: r.owner_name, phone: r.phone,
    vehicleType: r.vehicle_type, isMember: !!r.is_member, createdAt: r.created_at,
  };
}
function mapSession(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, spaceId: r.space_id, plateNo: r.plate_no,
    enterTime: r.enter_time, exitTime: r.exit_time, feeCents: r.fee_cents,
    status: r.status, paid: !!r.paid, createdAt: r.created_at,
    enterRuleId: r.enter_rule_id, transitionNotified: !!r.transition_notified,
  };
}

function mapOrganization(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, contact: r.contact, phone: r.phone,
    shareRatio: r.share_ratio, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapWhitelist(r) {
  if (!r) return null;
  return {
    id: r.id, orgId: r.org_id, plateNo: r.plate_no,
    startDate: r.start_date, endDate: r.end_date, status: r.status,
    createdAt: r.created_at,
  };
}
function mapRatePlan(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, rateType: r.rate_type,
    baseRateCents: r.base_rate_cents, freeMinutes: r.free_minutes,
    maxDailyCents: r.max_daily_cents, gracePeriodMinutes: r.grace_period_minutes,
    overtimeMultiplier: r.overtime_multiplier, isExclusive: !!r.is_exclusive,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapHoliday(r) {
  if (!r) return null;
  return {
    id: r.id, date: r.date, name: r.name, type: r.type, createdAt: r.created_at,
  };
}
function mapOwnershipRule(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, lotId: r.lot_id, orgId: r.org_id,
    ownershipType: r.ownership_type, ratePlanId: r.rate_plan_id,
    applicableDays: r.applicable_days, includeHolidays: !!r.include_holidays,
    timeStart: r.time_start, timeEnd: r.time_end, priority: r.priority,
    status: r.status, effectiveDate: r.effective_date, expiryDate: r.expiry_date,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapSpaceRuleBinding(r) {
  if (!r) return null;
  return {
    id: r.id, spaceId: r.space_id, ruleId: r.rule_id,
    effectiveDate: r.effective_date, expiryDate: r.expiry_date,
    status: r.status, createdAt: r.created_at,
  };
}
function mapTransitionEvent(r) {
  if (!r) return null;
  return {
    id: r.id, spaceId: r.space_id, sessionId: r.session_id,
    fromRuleId: r.from_rule_id, toRuleId: r.to_rule_id,
    transitionTime: r.transition_time, actionTaken: r.action_taken,
    graceExpiry: r.grace_expiry, notified: !!r.notified, note: r.note,
    createdAt: r.created_at,
  };
}
function mapBillingSegment(r) {
  if (!r) return null;
  return {
    id: r.id, sessionId: r.session_id, ruleId: r.rule_id,
    segmentStart: r.segment_start, segmentEnd: r.segment_end,
    durationMin: r.duration_min, rateCents: r.rate_cents,
    amountCents: r.amount_cents, isOvertime: !!r.is_overtime,
    createdAt: r.created_at,
  };
}
function mapSharedTransaction(r) {
  if (!r) return null;
  return {
    id: r.id, sessionId: r.session_id, spaceId: r.space_id,
    ruleId: r.rule_id, orgId: r.org_id, transactionType: r.transaction_type,
    totalAmountCents: r.total_amount_cents, orgShareCents: r.org_share_cents,
    operatorShareCents: r.operator_share_cents, shareRatio: r.share_ratio,
    settlementDate: r.settlement_date, settled: !!r.settled,
    createdAt: r.created_at,
  };
}
function mapUtilizationStat(r) {
  if (!r) return null;
  return {
    id: r.id, spaceId: r.space_id, statDate: r.stat_date,
    ownershipType: r.ownership_type, totalMinutes: r.total_minutes,
    occupiedMinutes: r.occupied_minutes, utilizationRate: r.utilization_rate,
    sessionCount: r.session_count, createdAt: r.created_at,
  };
}
function mapOwnershipSnapshot(r) {
  if (!r) return null;
  return {
    id: r.id, spaceId: r.space_id, currentRuleId: r.current_rule_id,
    ownershipType: r.ownership_type, orgId: r.org_id,
    available: !!r.available, nextTransition: r.next_transition,
    nextRuleId: r.next_rule_id, snapshotTime: r.snapshot_time,
  };
}

/* ----------------------------- 用户 ----------------------------- */

async function getUserByUsername(username) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE username = ?', [username]);
  return mapUserWithHash(rows[0]);
}
async function getUserById(id) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE id = ?', [id]);
  return mapUser(rows[0]);
}
async function listUsers() {
  const [rows] = await getPool().query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}
async function createUser({ username, password, name, role = 'VIEWER', status = 'ACTIVE' }) {
  const [r] = await getPool().query(
    'INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), name, role, status],
  );
  return getUserById(r.insertId);
}
async function updateUser(id, fields) {
  const map = { name: 'name', role: 'role', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { sets.push(`${col} = ?`); params.push(fields[k]); }
  }
  if (fields.password !== undefined) { sets.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getUserById(id);
}
async function deleteUser(id) {
  const [r] = await getPool().query('DELETE FROM users WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function countUsers() {
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM users');
  return rows[0].n;
}

/* ----------------------------- 停车场 ----------------------------- */

async function listLots({ district, status, keyword } = {}) {
  const where = []; const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('(code LIKE ? OR name LIKE ? OR address LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_lots ${clause} ORDER BY id DESC`, params);
  return rows.map(mapLot);
}
async function getLotById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE id = ?', [id]);
  return mapLot(rows[0]);
}
async function getLotByCode(code) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE code = ?', [code]);
  return mapLot(rows[0]);
}
async function createLot(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_lots (code, name, district, address, total_spaces, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.code, d.name, d.district, d.address || '', d.totalSpaces || 0, d.status || 'OPEN'],
  );
  return getLotById(r.insertId);
}
async function updateLot(id, d) {
  const map = { name: 'name', district: 'district', address: 'address', totalSpaces: 'total_spaces', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_lots SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getLotById(id);
}
async function deleteLot(id) {
  const [r] = await getPool().query('DELETE FROM parking_lots WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车位 ----------------------------- */

async function listSpaces({ lotId, status, type } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('type = ?'); params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_spaces ${clause} ORDER BY id`, params);
  return rows.map(mapSpace);
}
async function getSpaceById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [id]);
  return mapSpace(rows[0]);
}
async function getSpaceByCode(lotId, code) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE lot_id = ? AND code = ?', [lotId, code]);
  return mapSpace(rows[0]);
}
async function createSpace(d) {
  const [r] = await getPool().query(
    'INSERT INTO parking_spaces (lot_id, code, type, status) VALUES (?, ?, ?, ?)',
    [d.lotId, d.code, d.type || 'STANDARD', d.status || 'FREE'],
  );
  return getSpaceById(r.insertId);
}
async function updateSpace(id, d) {
  const map = { type: 'type', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_spaces SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getSpaceById(id);
}
async function deleteSpace(id) {
  const [r] = await getPool().query('DELETE FROM parking_spaces WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车辆 ----------------------------- */

async function listVehicles({ keyword, isMember } = {}) {
  const where = []; const params = [];
  if (keyword) { where.push('(plate_no LIKE ? OR owner_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k); }
  if (isMember !== undefined) { where.push('is_member = ?'); params.push(isMember ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM vehicles ${clause} ORDER BY id DESC`, params);
  return rows.map(mapVehicle);
}
async function getVehicleById(id) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE id = ?', [id]);
  return mapVehicle(rows[0]);
}
async function getVehicleByPlate(plateNo) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE plate_no = ?', [plateNo]);
  return mapVehicle(rows[0]);
}
async function createVehicle(d) {
  const [r] = await getPool().query(
    'INSERT INTO vehicles (plate_no, owner_name, phone, vehicle_type, is_member) VALUES (?, ?, ?, ?, ?)',
    [d.plateNo, d.ownerName || '', d.phone || '', d.vehicleType || 'SMALL', d.isMember ? 1 : 0],
  );
  return getVehicleById(r.insertId);
}
async function updateVehicle(id, d) {
  const map = { ownerName: 'owner_name', phone: 'phone', vehicleType: 'vehicle_type' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.isMember !== undefined) { sets.push('is_member = ?'); params.push(d.isMember ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getVehicleById(id);
}
async function deleteVehicle(id) {
  const [r] = await getPool().query('DELETE FROM vehicles WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 停车记录 ----------------------------- */

async function listSessions({ lotId, plateNo, status } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_sessions ${clause} ORDER BY id DESC`, params);
  return rows.map(mapSession);
}
async function getSessionById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_sessions WHERE id = ?', [id]);
  return mapSession(rows[0]);
}
async function createSession(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_sessions (lot_id, space_id, plate_no, enter_time, status)
     VALUES (?, ?, ?, ?, ?)`,
    [d.lotId, d.spaceId ?? null, d.plateNo, d.enterTime, d.status || 'PARKED'],
  );
  return getSessionById(r.insertId);
}
async function updateSession(id, d) {
  const map = { spaceId: 'space_id', exitTime: 'exit_time', feeCents: 'fee_cents', status: 'status', enterRuleId: 'enter_rule_id' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.paid !== undefined) { sets.push('paid = ?'); params.push(d.paid ? 1 : 0); }
  if (d.transitionNotified !== undefined) { sets.push('transition_notified = ?'); params.push(d.transitionNotified ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE parking_sessions SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getSessionById(id);
}

/* ----------------------------- 签约单位 ----------------------------- */

async function listOrganizations({ status } = {}) {
  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM contract_organizations ${clause} ORDER BY id DESC`, params);
  return rows.map(mapOrganization);
}
async function getOrganizationById(id) {
  const [rows] = await getPool().query('SELECT * FROM contract_organizations WHERE id = ?', [id]);
  return mapOrganization(rows[0]);
}
async function createOrganization(d) {
  const [r] = await getPool().query(
    'INSERT INTO contract_organizations (name, contact, phone, share_ratio, status) VALUES (?, ?, ?, ?, ?)',
    [d.name, d.contact || '', d.phone || '', d.shareRatio || 70.00, d.status || 'ACTIVE'],
  );
  return getOrganizationById(r.insertId);
}
async function updateOrganization(id, d) {
  const map = { name: 'name', contact: 'contact', phone: 'phone', shareRatio: 'share_ratio', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE contract_organizations SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getOrganizationById(id);
}
async function deleteOrganization(id) {
  const [r] = await getPool().query('DELETE FROM contract_organizations WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车辆白名单 ----------------------------- */

async function listWhitelist({ orgId, plateNo, status } = {}) {
  const where = []; const params = [];
  if (orgId !== undefined) { where.push('org_id = ?'); params.push(orgId); }
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM org_vehicle_whitelist ${clause} ORDER BY id DESC`, params);
  return rows.map(mapWhitelist);
}
async function getWhitelistByPlate(plateNo, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  const [rows] = await getPool().query(
    `SELECT * FROM org_vehicle_whitelist 
     WHERE plate_no = ? AND status = 'ACTIVE' 
       AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
    [plateNo, dateStr, dateStr]
  );
  return rows.map(mapWhitelist);
}
async function isPlateInWhitelist(plateNo, orgId, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM org_vehicle_whitelist 
     WHERE plate_no = ? AND org_id = ? AND status = 'ACTIVE' 
       AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
    [plateNo, orgId, dateStr, dateStr]
  );
  return rows[0].n > 0;
}
async function createWhitelist(d) {
  const [r] = await getPool().query(
    'INSERT INTO org_vehicle_whitelist (org_id, plate_no, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
    [d.orgId, d.plateNo, d.startDate, d.endDate || null, d.status || 'ACTIVE'],
  );
  const [rows] = await getPool().query('SELECT * FROM org_vehicle_whitelist WHERE id = ?', [r.insertId]);
  return mapWhitelist(rows[0]);
}
async function batchCreateWhitelist(orgId, plateNos, startDate, endDate = null) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const results = [];
    for (const plateNo of plateNos) {
      const [r] = await conn.query(
        'INSERT IGNORE INTO org_vehicle_whitelist (org_id, plate_no, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
        [orgId, plateNo, startDate, endDate, 'ACTIVE'],
      );
      if (r.affectedRows > 0) {
        const [rows] = await conn.query('SELECT * FROM org_vehicle_whitelist WHERE id = ?', [r.insertId]);
        results.push(mapWhitelist(rows[0]));
      }
    }
    await conn.commit();
    return results;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
async function updateWhitelist(id, d) {
  const map = { startDate: 'start_date', endDate: 'end_date', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE org_vehicle_whitelist SET ${sets.join(', ')} WHERE id = ?`, params); }
  const [rows] = await getPool().query('SELECT * FROM org_vehicle_whitelist WHERE id = ?', [id]);
  return mapWhitelist(rows[0]);
}
async function deleteWhitelist(id) {
  const [r] = await getPool().query('DELETE FROM org_vehicle_whitelist WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 费率方案 ----------------------------- */

async function listRatePlans({ status, isExclusive } = {}) {
  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (isExclusive !== undefined) { where.push('is_exclusive = ?'); params.push(isExclusive ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM rate_plans ${clause} ORDER BY id DESC`, params);
  return rows.map(mapRatePlan);
}
async function getRatePlanById(id) {
  const [rows] = await getPool().query('SELECT * FROM rate_plans WHERE id = ?', [id]);
  return mapRatePlan(rows[0]);
}
async function createRatePlan(d) {
  const [r] = await getPool().query(
    `INSERT INTO rate_plans (name, rate_type, base_rate_cents, free_minutes, max_daily_cents, 
      grace_period_minutes, overtime_multiplier, is_exclusive, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.name, d.rateType || 'HOURLY', d.baseRateCents || 0, d.freeMinutes || 15, d.maxDailyCents || null,
     d.gracePeriodMinutes || 30, d.overtimeMultiplier || 1.50, d.isExclusive ? 1 : 0, d.status || 'ACTIVE'],
  );
  return getRatePlanById(r.insertId);
}
async function updateRatePlan(id, d) {
  const map = {
    name: 'name', rateType: 'rate_type', baseRateCents: 'base_rate_cents',
    freeMinutes: 'free_minutes', maxDailyCents: 'max_daily_cents',
    gracePeriodMinutes: 'grace_period_minutes', overtimeMultiplier: 'overtime_multiplier',
    isExclusive: 'is_exclusive', status: 'status',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(k === 'isExclusive' ? (d[k] ? 1 : 0) : d[k]);
    }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE rate_plans SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getRatePlanById(id);
}
async function deleteRatePlan(id) {
  const [r] = await getPool().query('DELETE FROM rate_plans WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 节假日 ----------------------------- */

async function listHolidays({ startDate, endDate, type } = {}) {
  const where = []; const params = [];
  if (startDate) { where.push('date >= ?'); params.push(startDate); }
  if (endDate) { where.push('date <= ?'); params.push(endDate); }
  if (type) { where.push('type = ?'); params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM holidays ${clause} ORDER BY date`, params);
  return rows.map(mapHoliday);
}
async function isHoliday(date) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM holidays WHERE date = ?', [dateStr]);
  return rows[0].n > 0;
}
async function getHolidayByDate(date) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const [rows] = await getPool().query('SELECT * FROM holidays WHERE date = ?', [dateStr]);
  return mapHoliday(rows[0]);
}
async function createHoliday(d) {
  const [r] = await getPool().query(
    'INSERT INTO holidays (date, name, type) VALUES (?, ?, ?)',
    [d.date, d.name, d.type || 'PUBLIC'],
  );
  const [rows] = await getPool().query('SELECT * FROM holidays WHERE id = ?', [r.insertId]);
  return mapHoliday(rows[0]);
}
async function batchCreateHolidays(holidays) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const h of holidays) {
      await conn.query(
        'INSERT IGNORE INTO holidays (date, name, type) VALUES (?, ?, ?)',
        [h.date, h.name, h.type || 'PUBLIC'],
      );
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
async function deleteHoliday(id) {
  const [r] = await getPool().query('DELETE FROM holidays WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 时段归属规则 ----------------------------- */

async function listOwnershipRules({ lotId, orgId, ownershipType, status } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (orgId !== undefined) { where.push('org_id = ?'); params.push(orgId); }
  if (ownershipType) { where.push('ownership_type = ?'); params.push(ownershipType); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT * FROM time_ownership_rules ${clause} ORDER BY priority ASC, id DESC`,
    params
  );
  return rows.map(mapOwnershipRule);
}
async function getOwnershipRuleById(id) {
  const [rows] = await getPool().query('SELECT * FROM time_ownership_rules WHERE id = ?', [id]);
  return mapOwnershipRule(rows[0]);
}
async function getActiveRulesForLot(lotId, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  const [rows] = await getPool().query(
    `SELECT * FROM time_ownership_rules 
     WHERE lot_id = ? AND status = 'ACTIVE'
       AND (effective_date IS NULL OR effective_date <= ?)
       AND (expiry_date IS NULL OR expiry_date >= ?)
     ORDER BY priority ASC`,
    [lotId, dateStr, dateStr]
  );
  return rows.map(mapOwnershipRule);
}
async function createOwnershipRule(d) {
  const [r] = await getPool().query(
    `INSERT INTO time_ownership_rules 
     (name, lot_id, org_id, ownership_type, rate_plan_id, applicable_days, 
      include_holidays, time_start, time_end, priority, status, effective_date, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.name, d.lotId, d.orgId || null, d.ownershipType, d.ratePlanId,
     d.applicableDays || '1,2,3,4,5', d.includeHolidays ? 1 : 0,
     d.timeStart, d.timeEnd, d.priority || 10, d.status || 'ACTIVE',
     d.effectiveDate || null, d.expiryDate || null],
  );
  return getOwnershipRuleById(r.insertId);
}
async function updateOwnershipRule(id, d) {
  const map = {
    name: 'name', lotId: 'lot_id', orgId: 'org_id', ownershipType: 'ownership_type',
    ratePlanId: 'rate_plan_id', applicableDays: 'applicable_days',
    includeHolidays: 'include_holidays', timeStart: 'time_start', timeEnd: 'time_end',
    priority: 'priority', status: 'status', effectiveDate: 'effective_date', expiryDate: 'expiry_date',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(k === 'includeHolidays' ? (d[k] ? 1 : 0) : d[k]);
    }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE time_ownership_rules SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getOwnershipRuleById(id);
}
async function deleteOwnershipRule(id) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM space_rule_bindings WHERE rule_id = ?', [id]);
    const [r] = await conn.query('DELETE FROM time_ownership_rules WHERE id = ?', [id]);
    await conn.commit();
    return r.affectedRows > 0;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/* ----------------------------- 车位-规则绑定 ----------------------------- */

async function listSpaceRuleBindings({ spaceId, ruleId, status } = {}) {
  const where = []; const params = [];
  if (spaceId !== undefined) { where.push('space_id = ?'); params.push(spaceId); }
  if (ruleId !== undefined) { where.push('rule_id = ?'); params.push(ruleId); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM space_rule_bindings ${clause} ORDER BY id`, params);
  return rows.map(mapSpaceRuleBinding);
}
async function getBindingsForSpace(spaceId, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  const [rows] = await getPool().query(
    `SELECT srb.*, tor.* FROM space_rule_bindings srb
     JOIN time_ownership_rules tor ON srb.rule_id = tor.id
     WHERE srb.space_id = ? AND srb.status = 'ACTIVE' AND tor.status = 'ACTIVE'
       AND (srb.effective_date IS NULL OR srb.effective_date <= ?)
       AND (srb.expiry_date IS NULL OR srb.expiry_date >= ?)
       AND (tor.effective_date IS NULL OR tor.effective_date <= ?)
       AND (tor.expiry_date IS NULL OR tor.expiry_date >= ?)
     ORDER BY tor.priority ASC`,
    [spaceId, dateStr, dateStr, dateStr, dateStr]
  );
  return rows.map(r => ({ binding: mapSpaceRuleBinding(r), rule: mapOwnershipRule(r) }));
}
async function getBindingsForSpaces(spaceIds, date = new Date()) {
  if (!spaceIds || spaceIds.length === 0) return [];
  const dateStr = date.toISOString().slice(0, 10);
  const placeholders = spaceIds.map(() => '?').join(',');
  const params = [...spaceIds, dateStr, dateStr, dateStr, dateStr];
  const [rows] = await getPool().query(
    `SELECT srb.*, tor.* FROM space_rule_bindings srb
     JOIN time_ownership_rules tor ON srb.rule_id = tor.id
     WHERE srb.space_id IN (${placeholders}) AND srb.status = 'ACTIVE' AND tor.status = 'ACTIVE'
       AND (srb.effective_date IS NULL OR srb.effective_date <= ?)
       AND (srb.expiry_date IS NULL OR srb.expiry_date >= ?)
       AND (tor.effective_date IS NULL OR tor.effective_date <= ?)
       AND (tor.expiry_date IS NULL OR tor.expiry_date >= ?)
     ORDER BY srb.space_id, tor.priority ASC`,
    params
  );
  const result = new Map();
  for (const r of rows) {
    if (!result.has(r.space_id)) result.set(r.space_id, []);
    result.get(r.space_id).push({ binding: mapSpaceRuleBinding(r), rule: mapOwnershipRule(r) });
  }
  return result;
}
async function createSpaceRuleBinding(d) {
  const [r] = await getPool().query(
    'INSERT INTO space_rule_bindings (space_id, rule_id, effective_date, expiry_date, status) VALUES (?, ?, ?, ?, ?)',
    [d.spaceId, d.ruleId, d.effectiveDate || null, d.expiryDate || null, d.status || 'ACTIVE'],
  );
  const [rows] = await getPool().query('SELECT * FROM space_rule_bindings WHERE id = ?', [r.insertId]);
  return mapSpaceRuleBinding(rows[0]);
}
async function batchBindRulesToSpaces(spaceIds, ruleIds, effectiveDate = null, expiryDate = null) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const results = [];
    for (const spaceId of spaceIds) {
      for (const ruleId of ruleIds) {
        const [r] = await conn.query(
          'INSERT IGNORE INTO space_rule_bindings (space_id, rule_id, effective_date, expiry_date, status) VALUES (?, ?, ?, ?, ?)',
          [spaceId, ruleId, effectiveDate, expiryDate, 'ACTIVE'],
        );
        if (r.affectedRows > 0 && r.insertId > 0) {
          const [rows] = await conn.query('SELECT * FROM space_rule_bindings WHERE id = ?', [r.insertId]);
          results.push(mapSpaceRuleBinding(rows[0]));
        }
      }
    }
    await conn.commit();
    return results;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
async function batchBindByLotZone(lotId, zonePrefix, ruleIds, effectiveDate = null, expiryDate = null) {
  const [spaces] = await getPool().query(
    'SELECT id FROM parking_spaces WHERE lot_id = ? AND code LIKE ?',
    [lotId, `${zonePrefix}%`]
  );
  const spaceIds = spaces.map(s => s.id);
  return batchBindRulesToSpaces(spaceIds, ruleIds, effectiveDate, expiryDate);
}
async function updateSpaceRuleBinding(id, d) {
  const map = { effectiveDate: 'effective_date', expiryDate: 'expiry_date', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE space_rule_bindings SET ${sets.join(', ')} WHERE id = ?`, params); }
  const [rows] = await getPool().query('SELECT * FROM space_rule_bindings WHERE id = ?', [id]);
  return mapSpaceRuleBinding(rows[0]);
}
async function deleteSpaceRuleBinding(id) {
  const [r] = await getPool().query('DELETE FROM space_rule_bindings WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function unbindRuleFromSpaces(ruleId, spaceIds) {
  if (!spaceIds || spaceIds.length === 0) return 0;
  const placeholders = spaceIds.map(() => '?').join(',');
  const [r] = await getPool().query(
    `DELETE FROM space_rule_bindings WHERE rule_id = ? AND space_id IN (${placeholders})`,
    [ruleId, ...spaceIds]
  );
  return r.affectedRows;
}

/* ----------------------------- 时段切换事件 ----------------------------- */

async function createTransitionEvent(d) {
  const [r] = await getPool().query(
    `INSERT INTO transition_events 
     (space_id, session_id, from_rule_id, to_rule_id, transition_time, 
      action_taken, grace_expiry, notified, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.spaceId, d.sessionId, d.fromRuleId || null, d.toRuleId, d.transitionTime,
     d.actionTaken, d.graceExpiry || null, d.notified ? 1 : 0, d.note || null],
  );
  const [rows] = await getPool().query('SELECT * FROM transition_events WHERE id = ?', [r.insertId]);
  return mapTransitionEvent(rows[0]);
}
async function listTransitionEvents({ spaceId, sessionId, fromTime, toTime } = {}) {
  const where = []; const params = [];
  if (spaceId !== undefined) { where.push('space_id = ?'); params.push(spaceId); }
  if (sessionId !== undefined) { where.push('session_id = ?'); params.push(sessionId); }
  if (fromTime) { where.push('transition_time >= ?'); params.push(fromTime); }
  if (toTime) { where.push('transition_time <= ?'); params.push(toTime); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM transition_events ${clause} ORDER BY transition_time DESC`, params);
  return rows.map(mapTransitionEvent);
}
async function getPendingTransitions(graceExpiryBefore) {
  const [rows] = await getPool().query(
    `SELECT * FROM transition_events 
     WHERE grace_expiry IS NOT NULL AND grace_expiry <= ? AND notified = 0
     ORDER BY grace_expiry ASC`,
    [graceExpiryBefore]
  );
  return rows.map(mapTransitionEvent);
}
async function markTransitionNotified(id) {
  await getPool().query('UPDATE transition_events SET notified = 1 WHERE id = ?', [id]);
}

/* ----------------------------- 分段计费明细 ----------------------------- */

async function createBillingSegment(d) {
  const [r] = await getPool().query(
    `INSERT INTO billing_segments 
     (session_id, rule_id, segment_start, segment_end, duration_min, rate_cents, amount_cents, is_overtime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.sessionId, d.ruleId, d.segmentStart, d.segmentEnd, d.durationMin,
     d.rateCents, d.amountCents, d.isOvertime ? 1 : 0],
  );
  const [rows] = await getPool().query('SELECT * FROM billing_segments WHERE id = ?', [r.insertId]);
  return mapBillingSegment(rows[0]);
}
async function getSegmentsForSession(sessionId) {
  const [rows] = await getPool().query(
    'SELECT * FROM billing_segments WHERE session_id = ? ORDER BY segment_start',
    [sessionId]
  );
  return rows.map(mapBillingSegment);
}
async function deleteSegmentsForSession(sessionId) {
  const [r] = await getPool().query('DELETE FROM billing_segments WHERE session_id = ?', [sessionId]);
  return r.affectedRows;
}

/* ----------------------------- 共享收益流水 ----------------------------- */

async function createSharedTransaction(d) {
  const [r] = await getPool().query(
    `INSERT INTO shared_transactions 
     (session_id, space_id, rule_id, org_id, transaction_type, total_amount_cents, 
      org_share_cents, operator_share_cents, share_ratio, settlement_date, settled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.sessionId, d.spaceId, d.ruleId, d.orgId || null, d.transactionType,
     d.totalAmountCents || 0, d.orgShareCents || 0, d.operatorShareCents || 0,
     d.shareRatio, d.settlementDate || null, d.settled ? 1 : 0],
  );
  const [rows] = await getPool().query('SELECT * FROM shared_transactions WHERE id = ?', [r.insertId]);
  return mapSharedTransaction(rows[0]);
}
async function listSharedTransactions({ orgId, spaceId, settled, fromDate, toDate } = {}) {
  const where = []; const params = [];
  if (orgId !== undefined) { where.push('org_id = ?'); params.push(orgId); }
  if (spaceId !== undefined) { where.push('space_id = ?'); params.push(spaceId); }
  if (settled !== undefined) { where.push('settled = ?'); params.push(settled ? 1 : 0); }
  if (fromDate) { where.push('created_at >= ?'); params.push(fromDate); }
  if (toDate) { where.push('created_at <= ?'); params.push(toDate); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM shared_transactions ${clause} ORDER BY created_at DESC`, params);
  return rows.map(mapSharedTransaction);
}
async function getUnsettledTransactions(orgId = null) {
  const where = ['settled = 0']; const params = [];
  if (orgId !== undefined && orgId !== null) { where.push('org_id = ?'); params.push(orgId); }
  const clause = `WHERE ${where.join(' AND ')}`;
  const [rows] = await getPool().query(
    `SELECT *, SUM(total_amount_cents) as total, SUM(org_share_cents) as org_total, 
            SUM(operator_share_cents) as op_total 
     FROM shared_transactions ${clause}
     GROUP BY org_id WITH ROLLUP`,
    params
  );
  return rows;
}
async function settleTransactions(transactionIds, settlementDate) {
  if (!transactionIds || transactionIds.length === 0) return 0;
  const placeholders = transactionIds.map(() => '?').join(',');
  const [r] = await getPool().query(
    `UPDATE shared_transactions SET settled = 1, settlement_date = ? WHERE id IN (${placeholders})`,
    [settlementDate, ...transactionIds]
  );
  return r.affectedRows;
}

/* ----------------------------- 利用率统计 ----------------------------- */

async function createUtilizationStat(d) {
  const [r] = await getPool().query(
    `INSERT INTO utilization_stats 
     (space_id, stat_date, ownership_type, total_minutes, occupied_minutes, 
      utilization_rate, session_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_minutes = VALUES(total_minutes),
       occupied_minutes = VALUES(occupied_minutes),
       utilization_rate = VALUES(utilization_rate),
       session_count = VALUES(session_count)`,
    [d.spaceId, d.statDate, d.ownershipType, d.totalMinutes || 0,
     d.occupiedMinutes || 0, d.utilizationRate || 0, d.sessionCount || 0],
  );
  const [rows] = await getPool().query(
    'SELECT * FROM utilization_stats WHERE space_id = ? AND stat_date = ? AND ownership_type = ?',
    [d.spaceId, d.statDate, d.ownershipType]
  );
  return mapUtilizationStat(rows[0]);
}
async function listUtilizationStats({ spaceId, fromDate, toDate, ownershipType } = {}) {
  const where = []; const params = [];
  if (spaceId !== undefined) { where.push('space_id = ?'); params.push(spaceId); }
  if (fromDate) { where.push('stat_date >= ?'); params.push(fromDate); }
  if (toDate) { where.push('stat_date <= ?'); params.push(toDate); }
  if (ownershipType) { where.push('ownership_type = ?'); params.push(ownershipType); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM utilization_stats ${clause} ORDER BY stat_date DESC`, params);
  return rows.map(mapUtilizationStat);
}
async function getUtilizationSummary({ spaceId, fromDate, toDate, ownershipType } = {}) {
  const where = []; const params = [];
  if (spaceId !== undefined) { where.push('space_id = ?'); params.push(spaceId); }
  if (fromDate) { where.push('stat_date >= ?'); params.push(fromDate); }
  if (toDate) { where.push('stat_date <= ?'); params.push(toDate); }
  if (ownershipType) { where.push('ownership_type = ?'); params.push(ownershipType); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT ownership_type, 
            SUM(total_minutes) as total_minutes, 
            SUM(occupied_minutes) as occupied_minutes,
            AVG(utilization_rate) as avg_utilization_rate,
            SUM(session_count) as total_sessions,
            COUNT(*) as days
     FROM utilization_stats ${clause}
     GROUP BY ownership_type WITH ROLLUP`,
    params
  );
  return rows;
}

/* ----------------------------- 实时状态快照 ----------------------------- */

async function getOwnershipSnapshot(spaceId) {
  const [rows] = await getPool().query('SELECT * FROM space_ownership_snapshots WHERE space_id = ?', [spaceId]);
  return mapOwnershipSnapshot(rows[0]);
}
async function getAllOwnershipSnapshots({ lotId, available, ownershipType } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) {
    where.push('space_id IN (SELECT id FROM parking_spaces WHERE lot_id = ?)');
    params.push(lotId);
  }
  if (available !== undefined) { where.push('available = ?'); params.push(available ? 1 : 0); }
  if (ownershipType) { where.push('ownership_type = ?'); params.push(ownershipType); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM space_ownership_snapshots ${clause} ORDER BY space_id`, params);
  return rows.map(mapOwnershipSnapshot);
}
async function upsertOwnershipSnapshot(d) {
  const [r] = await getPool().query(
    `INSERT INTO space_ownership_snapshots 
     (space_id, current_rule_id, ownership_type, org_id, available, next_transition, next_rule_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_rule_id = VALUES(current_rule_id),
       ownership_type = VALUES(ownership_type),
       org_id = VALUES(org_id),
       available = VALUES(available),
       next_transition = VALUES(next_transition),
       next_rule_id = VALUES(next_rule_id)`,
    [d.spaceId, d.currentRuleId || null, d.ownershipType || null, d.orgId || null,
     d.available ? 1 : 0, d.nextTransition || null, d.nextRuleId || null],
  );
  return getOwnershipSnapshot(d.spaceId);
}
async function batchUpsertSnapshots(snapshots) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const d of snapshots) {
      await conn.query(
        `INSERT INTO space_ownership_snapshots 
         (space_id, current_rule_id, ownership_type, org_id, available, next_transition, next_rule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           current_rule_id = VALUES(current_rule_id),
           ownership_type = VALUES(ownership_type),
           org_id = VALUES(org_id),
           available = VALUES(available),
           next_transition = VALUES(next_transition),
           next_rule_id = VALUES(next_rule_id)`,
        [d.spaceId, d.currentRuleId || null, d.ownershipType || null, d.orgId || null,
         d.available ? 1 : 0, d.nextTransition || null, d.nextRuleId || null],
      );
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/* ----------------------------- 工具查询 ----------------------------- */

async function getActiveParkedSessions() {
  const [rows] = await getPool().query(
    `SELECT ps.*, ps2.status as space_status 
     FROM parking_sessions ps 
     LEFT JOIN parking_spaces ps2 ON ps.space_id = ps2.id
     WHERE ps.status = 'PARKED'
     ORDER BY ps.enter_time`,
  );
  return rows.map(mapSession);
}
async function getParkedSessionForSpace(spaceId) {
  const [rows] = await getPool().query(
    'SELECT * FROM parking_sessions WHERE space_id = ? AND status = \'PARKED\' ORDER BY enter_time DESC LIMIT 1',
    [spaceId]
  );
  return mapSession(rows[0]);
}

module.exports = {
  mapUser, mapLot, mapSpace, mapVehicle, mapSession,
  mapOrganization, mapWhitelist, mapRatePlan, mapHoliday,
  mapOwnershipRule, mapSpaceRuleBinding, mapTransitionEvent,
  mapBillingSegment, mapSharedTransaction, mapUtilizationStat, mapOwnershipSnapshot,
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, countUsers,
  listLots, getLotById, getLotByCode, createLot, updateLot, deleteLot,
  listSpaces, getSpaceById, getSpaceByCode, createSpace, updateSpace, deleteSpace,
  listVehicles, getVehicleById, getVehicleByPlate, createVehicle, updateVehicle, deleteVehicle,
  listSessions, getSessionById, createSession, updateSession, getActiveParkedSessions, getParkedSessionForSpace,
  listOrganizations, getOrganizationById, createOrganization, updateOrganization, deleteOrganization,
  listWhitelist, getWhitelistByPlate, isPlateInWhitelist, createWhitelist, batchCreateWhitelist,
  updateWhitelist, deleteWhitelist,
  listRatePlans, getRatePlanById, createRatePlan, updateRatePlan, deleteRatePlan,
  listHolidays, isHoliday, getHolidayByDate, createHoliday, batchCreateHolidays, deleteHoliday,
  listOwnershipRules, getOwnershipRuleById, getActiveRulesForLot, createOwnershipRule,
  updateOwnershipRule, deleteOwnershipRule,
  listSpaceRuleBindings, getBindingsForSpace, getBindingsForSpaces, createSpaceRuleBinding,
  batchBindRulesToSpaces, batchBindByLotZone, updateSpaceRuleBinding, deleteSpaceRuleBinding,
  unbindRuleFromSpaces,
  createTransitionEvent, listTransitionEvents, getPendingTransitions, markTransitionNotified,
  createBillingSegment, getSegmentsForSession, deleteSegmentsForSession,
  createSharedTransaction, listSharedTransactions, getUnsettledTransactions, settleTransactions,
  createUtilizationStat, listUtilizationStats, getUtilizationSummary,
  getOwnershipSnapshot, getAllOwnershipSnapshots, upsertOwnershipSnapshot, batchUpsertSnapshots,
};
