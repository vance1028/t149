'use strict';

const express = require('express');
const store = require('../data/store');
const scheduler = require('../core/ownership-scheduler');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const { lotId, orgId, ownershipType, status } = req.query;
    const filter = { ownershipType, status };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    if (orgId !== undefined) filter.orgId = Number(orgId);
    return sendData(res, 200, await store.listOwnershipRules(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const rule = await store.getOwnershipRuleById(id);
    if (!rule) return sendError(res, 404, '规则不存在');
    return sendData(res, 200, rule);
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { name, lotId, orgId, ownershipType, ratePlanId, applicableDays,
            includeHolidays, timeStart, timeEnd, priority, status,
            effectiveDate, expiryDate } = req.body || {};
    if (!name || !lotId || !ownershipType || !ratePlanId || !timeStart || !timeEnd) {
      return sendError(res, 400, '名称、停车场、归属类型、费率方案、开始时间、结束时间不能为空');
    }
    const rule = await store.createOwnershipRule({
      name, lotId: Number(lotId), orgId: orgId ? Number(orgId) : null,
      ownershipType, ratePlanId: Number(ratePlanId), applicableDays,
      includeHolidays, timeStart, timeEnd, priority, status, effectiveDate, expiryDate,
    });
    return sendData(res, 201, rule);
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOwnershipRuleById(id))) return sendError(res, 404, '规则不存在');
    return sendData(res, 200, await store.updateOwnershipRule(id, req.body || {}));
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOwnershipRuleById(id))) return sendError(res, 404, '规则不存在');
    await store.deleteOwnershipRule(id);
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

router.post('/:id/bind-spaces', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOwnershipRuleById(id))) return sendError(res, 404, '规则不存在');
    const { spaceIds, effectiveDate, expiryDate } = req.body || {};
    if (!Array.isArray(spaceIds) || spaceIds.length === 0) {
      return sendError(res, 400, '车位ID列表不能为空');
    }
    const results = await store.batchBindRulesToSpaces(spaceIds, [id], effectiveDate, expiryDate);
    return sendData(res, 200, { bound: results.length, results });
  } catch (e) { return next(e); }
});

router.post('/:id/bind-zone', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const rule = await store.getOwnershipRuleById(id);
    if (!rule) return sendError(res, 404, '规则不存在');
    const { zonePrefix, effectiveDate, expiryDate } = req.body || {};
    if (!zonePrefix) return sendError(res, 400, '区域前缀不能为空');
    const results = await store.batchBindByLotZone(rule.lotId, zonePrefix, [id], effectiveDate, expiryDate);
    return sendData(res, 200, { bound: results.length, results });
  } catch (e) { return next(e); }
});

router.post('/:id/unbind-spaces', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOwnershipRuleById(id))) return sendError(res, 404, '规则不存在');
    const { spaceIds } = req.body || {};
    if (!Array.isArray(spaceIds) || spaceIds.length === 0) {
      return sendError(res, 400, '车位ID列表不能为空');
    }
    const count = await store.unbindRuleFromSpaces(id, spaceIds);
    return sendData(res, 200, { unbound: count });
  } catch (e) { return next(e); }
});

router.get('/bindings/space/:spaceId', async (req, res, next) => {
  try {
    const spaceId = parseId(req.params.spaceId);
    const bindings = await store.listSpaceRuleBindings({ spaceId });
    return sendData(res, 200, bindings);
  } catch (e) { return next(e); }
});

router.get('/current/space/:spaceId', async (req, res, next) => {
  try {
    const spaceId = parseId(req.params.spaceId);
    const time = req.query.time ? new Date(req.query.time) : new Date();
    const ownership = await scheduler.getSpaceOwnership(spaceId, time);
    return sendData(res, 200, ownership);
  } catch (e) { return next(e); }
});

router.get('/current/all', async (req, res, next) => {
  try {
    const { lotId } = req.query;
    const lotIdNum = lotId !== undefined ? Number(lotId) : null;
    const time = req.query.time ? new Date(req.query.time) : new Date();
    const ownerships = await scheduler.getAllSpacesOwnership(lotIdNum, time);
    return sendData(res, 200, { count: ownerships.length, ownerships });
  } catch (e) { return next(e); }
});

router.post('/snapshots/refresh', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { lotId } = req.body || {};
    const lotIdNum = lotId !== undefined ? Number(lotId) : null;
    const snapshots = await scheduler.refreshAllSnapshots(lotIdNum);
    return sendData(res, 200, { refreshed: snapshots.length, snapshots });
  } catch (e) { return next(e); }
});

router.get('/snapshots', async (req, res, next) => {
  try {
    const { lotId, available, ownershipType } = req.query;
    const filter = { ownershipType };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    if (available !== undefined) filter.available = available === 'true';
    const snapshots = await store.getAllOwnershipSnapshots(filter);
    return sendData(res, 200, { count: snapshots.length, snapshots });
  } catch (e) { return next(e); }
});

router.get('/transitions/check', async (req, res, next) => {
  try {
    const fromTime = req.query.fromTime ? new Date(req.query.fromTime) : new Date();
    const toTime = req.query.toTime ? new Date(req.query.toTime) : new Date(fromTime.getTime() + 60 * 60 * 1000);
    const transitions = await scheduler.checkForTransitions(fromTime, toTime);
    return sendData(res, 200, { count: transitions.length, transitions });
  } catch (e) { return next(e); }
});

module.exports = router;
