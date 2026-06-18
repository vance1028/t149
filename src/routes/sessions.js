'use strict';

const express = require('express');
const store = require('../data/store');
const accessController = require('../core/access-controller');
const revenueService = require('../core/revenue-service');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

/** GET /api/sessions —— 停车记录列表（lotId / plateNo / status 过滤）。 */
router.get('/', async (req, res, next) => {
  try {
    const { lotId, plateNo, status } = req.query;
    const filter = { plateNo, status };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    return sendData(res, 200, await store.listSessions(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    return sendData(res, 200, s);
  } catch (e) { return next(e); }
});

/** POST /api/sessions/enter —— 车辆入场，带归属约束校验和车位分配。 */
router.post('/enter', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { lotId, plateNo, spaceId, enterTime } = req.body || {};
    if (lotId === undefined || !plateNo) return sendError(res, 400, '停车场和车牌号不能为空');

    const entryTime = enterTime ? new Date(enterTime) : new Date();
    const result = await accessController.processVehicleEntry(
      Number(lotId),
      plateNo,
      spaceId ? Number(spaceId) : null,
      entryTime
    );

    if (!result.success) {
      return sendError(res, 400, result.reason || '入场失败');
    }

    return sendData(res, 201, result.session, {
      ownership: result.ownership,
      isExclusive: result.isExclusive,
      note: result.note,
    });
  } catch (e) { return next(e); }
});

/** POST /api/sessions/:id/exit —— 车辆出场，自动分段计费和收益归集。 */
router.post('/:id/exit', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    if (s.status !== 'PARKED') return sendError(res, 409, '该记录已结束，不能重复出场');

    const exitTime = req.body.exitTime ? new Date(req.body.exitTime) : new Date();
    const manualFeeCents = req.body.feeCents;

    const result = await accessController.processVehicleExit(id, exitTime);

    if (!result.success) {
      return sendError(res, 400, result.reason || '出场失败');
    }

    if (manualFeeCents !== undefined && manualFeeCents !== null) {
      await store.updateSession(id, { feeCents: Number(manualFeeCents) });
      result.totalCents = Number(manualFeeCents);
      result.session.feeCents = Number(manualFeeCents);
    }

    await revenueService.processSessionForRevenue(id);

    const finalSession = await store.getSessionById(id);
    return sendData(res, 200, finalSession, {
      segments: result.segments,
      totalCents: result.totalCents,
    });
  } catch (e) { return next(e); }
});

module.exports = router;
