'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    return sendData(res, 200, await store.listOrganizations({ status }));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const org = await store.getOrganizationById(id);
    if (!org) return sendError(res, 404, '签约单位不存在');
    return sendData(res, 200, org);
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { name, contact, phone, shareRatio } = req.body || {};
    if (!name) return sendError(res, 400, '单位名称不能为空');
    const org = await store.createOrganization({
      name, contact, phone, shareRatio });
    return sendData(res, 201, org);
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOrganizationById(id))) return sendError(res, 404, '签约单位不存在');
    return sendData(res, 200, await store.updateOrganization(id, req.body || {}));
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOrganizationById(id))) return sendError(res, 404, '签约单位不存在');
    await store.deleteOrganization(id);
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

router.get('/:id/whitelist', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { plateNo, status } = req.query;
    return sendData(res, 200, await store.listWhitelist({ orgId: id, plateNo, status }));
  } catch (e) { return next(e); }
});

router.post('/:id/whitelist', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOrganizationById(id))) return sendError(res, 404, '签约单位不存在');
    const { plateNo, startDate, endDate } = req.body || {};
    if (!plateNo || !startDate) return sendError(res, 400, '车牌号和开始日期不能为空');
    const item = await store.createWhitelist({ orgId: id, plateNo, startDate, endDate });
    return sendData(res, 201, item);
  } catch (e) { return next(e); }
});

router.post('/:id/whitelist/batch', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getOrganizationById(id))) return sendError(res, 404, '签约单位不存在');
    const { plateNos, startDate, endDate } = req.body || {};
    if (!Array.isArray(plateNos) || plateNos.length === 0) return sendError(res, 400, '车牌号列表不能为空');
    if (!startDate) return sendError(res, 400, '开始日期不能为空');
    const results = await store.batchCreateWhitelist(id, plateNos, startDate, endDate);
    return sendData(res, 201, { added: results.length, results });
  } catch (e) { return next(e); }
});

router.put('/whitelist/:itemId', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const itemId = parseId(req.params.itemId);
    return sendData(res, 200, await store.updateWhitelist(itemId, req.body || {}));
  } catch (e) { return next(e); }
});

router.delete('/whitelist/:itemId', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const itemId = parseId(req.params.itemId);
    await store.deleteWhitelist(itemId);
    return sendData(res, 200, { id: itemId });
  } catch (e) { return next(e); }
});

module.exports = router;
