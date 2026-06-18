'use strict';

const express = require('express');
const revenueService = require('../core/revenue-service');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const { orgId, spaceId, settled, fromDate, toDate } = req.query;
    const filter = { settled: settled !== undefined ? settled === 'true' : undefined };
    if (orgId !== undefined) filter.orgId = Number(orgId);
    if (spaceId !== undefined) filter.spaceId = Number(spaceId);
    if (fromDate) filter.fromDate = fromDate;
    if (toDate) filter.toDate = toDate;
    const data = await revenueService.getRevenueSummary(filter);
    return sendData(res, 200, data);
  } catch (e) { return next(e); }
});

router.post('/process/:sessionId', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const sessionId = parseId(req.params.sessionId);
    const result = await revenueService.processSessionForRevenue(sessionId);
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.post('/process/batch', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.body || {};
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const result = await revenueService.batchProcessSessionsForRevenue(fromDate, toDate);
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.get('/org/:orgId', async (req, res, next) => {
  try {
    const orgId = parseId(req.params.orgId);
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const report = await revenueService.getOrgRevenueReport(orgId, fromDate, toDate);
    if (!report) return sendError(res, 404, '签约单位不存在');
    return sendData(res, 200, report);
  } catch (e) { return next(e); }
});

router.post('/org/:orgId/settle', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const orgId = parseId(req.params.orgId);
    const { settlementDate } = req.body || {};
    if (!settlementDate) return sendError(res, 400, '结算日期不能为空');
    const result = await revenueService.settleOrgTransactions(orgId, settlementDate);
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.get('/settlement-report', async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const report = await revenueService.getSettlementReport(fromDate, toDate);
    return sendData(res, 200, report);
  } catch (e) { return next(e); }
});

module.exports = router;
