'use strict';

const express = require('express');
const billingService = require('../core/billing-service');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/session/:sessionId', async (req, res, next) => {
  try {
    const sessionId = parseId(req.params.sessionId);
    const details = await billingService.getSessionBillingDetails(sessionId);
    if (!details) return sendError(res, 404, '停车记录不存在');
    return sendData(res, 200, details);
  } catch (e) { return next(e); }
});

router.post('/session/:sessionId/recalculate', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const sessionId = parseId(req.params.sessionId);
    const result = await billingService.recalculateSessionFee(sessionId);
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.get('/summary/date/:date', async (req, res, next) => {
  try {
    const { date } = req.params;
    const { lotId } = req.query;
    const lotIdNum = lotId !== undefined ? Number(lotId) : null;
    const summary = await billingService.getBillingSummaryByDate(date, lotIdNum);
    return sendData(res, 200, summary);
  } catch (e) { return next(e); }
});

module.exports = router;
