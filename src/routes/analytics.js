'use strict';

const express = require('express');
const analyticsService = require('../core/analytics-service');
const accessController = require('../core/access-controller');
const transitionHandler = require('../core/transition-handler');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/space/:spaceId/trend', async (req, res, next) => {
  try {
    const spaceId = parseId(req.params.spaceId);
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const trend = await analyticsService.getSpaceUtilizationTrend(spaceId, fromDate, toDate);
    return sendData(res, 200, { count: trend.length, trend });
  } catch (e) { return next(e); }
});

router.get('/lot/:lotId/utilization', async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const report = await analyticsService.getLotUtilizationReport(lotId, fromDate, toDate);
    return sendData(res, 200, report);
  } catch (e) { return next(e); }
});

router.get('/lot/:lotId/optimization', async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const recommendations = await analyticsService.getOptimizationRecommendations(lotId, fromDate, toDate);
    return sendData(res, 200, recommendations);
  } catch (e) { return next(e); }
});

router.get('/org/:orgId/efficiency', async (req, res, next) => {
  try {
    const orgId = parseId(req.params.orgId);
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) return sendError(res, 400, '开始和结束日期不能为空');
    const report = await analyticsService.getOwnershipEfficiencyReport(orgId, fromDate, toDate);
    return sendData(res, 200, report);
  } catch (e) { return next(e); }
});

router.post('/daily-run', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { date } = req.body || {};
    const runDate = date ? new Date(date) : new Date();
    const result = await analyticsService.runDailyAnalytics(runDate);
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.get('/lot/:lotId/realtime', async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    const status = await accessController.getLotRealtimeStatus(lotId);
    return sendData(res, 200, status);
  } catch (e) { return next(e); }
});

router.get('/vehicle/:plateNo/status', async (req, res, next) => {
  try {
    const { plateNo } = req.params;
    const status = await accessController.getVehicleParkingStatus(plateNo);
    return sendData(res, 200, status);
  } catch (e) { return next(e); }
});

router.get('/lot/:lotId/recommend/:plateNo', async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    const { plateNo } = req.params;
    const recommendations = await accessController.getEntryRecommendations(lotId, plateNo);
    return sendData(res, 200, recommendations);
  } catch (e) { return next(e); }
});

router.get('/transitions/notifications', async (req, res, next) => {
  try {
    const { lotId } = req.query;
    const lotIdNum = lotId !== undefined ? Number(lotId) : null;
    const notifications = await transitionHandler.getTransitionNotifications(lotIdNum);
    return sendData(res, 200, { count: notifications.length, notifications });
  } catch (e) { return next(e); }
});

router.post('/transitions/run-check', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await transitionHandler.runTransitionCheck();
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

module.exports = router;
