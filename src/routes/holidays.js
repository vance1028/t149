'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const { startDate, endDate, type } = req.query;
    return sendData(res, 200, await store.listHolidays({ startDate, endDate, type }));
  } catch (e) { return next(e); }
});

router.get('/check/:date', async (req, res, next) => {
  try {
    const { date } = req.params;
    const isHol = await store.isHoliday(date);
    const holiday = isHol ? await store.getHolidayByDate(date) : null;
    return sendData(res, 200, { isHoliday: isHol, holiday });
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { date, name, type } = req.body || {};
    if (!date || !name) return sendError(res, 400, '日期和名称不能为空');
    const holiday = await store.createHoliday({ date, name, type });
    return sendData(res, 201, holiday);
  } catch (e) { return next(e); }
});

router.post('/batch', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { holidays } = req.body || {};
    if (!Array.isArray(holidays) || holidays.length === 0) {
      return sendError(res, 400, '节假日列表不能为空');
    }
    await store.batchCreateHolidays(holidays);
    return sendData(res, 201, { count: holidays.length });
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await store.deleteHoliday(id);
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

module.exports = router;
