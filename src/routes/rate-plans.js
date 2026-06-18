'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const { status, isExclusive } = req.query;
    const filter = { status };
    if (isExclusive !== undefined) filter.isExclusive = isExclusive === 'true';
    return sendData(res, 200, await store.listRatePlans(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const plan = await store.getRatePlanById(id);
    if (!plan) return sendError(res, 404, '费率方案不存在');
    return sendData(res, 200, plan);
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { name, rateType, baseRateCents, freeMinutes, maxDailyCents,
            gracePeriodMinutes, overtimeMultiplier, isExclusive, status } = req.body || {};
    if (!name) return sendError(res, 400, '方案名称不能为空');
    const plan = await store.createRatePlan({
      name, rateType, baseRateCents, freeMinutes, maxDailyCents,
      gracePeriodMinutes, overtimeMultiplier, isExclusive, status,
    });
    return sendData(res, 201, plan);
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getRatePlanById(id))) return sendError(res, 404, '费率方案不存在');
    return sendData(res, 200, await store.updateRatePlan(id, req.body || {}));
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getRatePlanById(id))) return sendError(res, 404, '费率方案不存在');
    await store.deleteRatePlan(id);
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

module.exports = router;
