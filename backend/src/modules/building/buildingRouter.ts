import { Router } from 'express';
import { z } from 'zod';
import { ah, idParam, notFound, badRequest } from '../../lib/http';
import { requirePermission, assertBuildingAccess } from '../../middleware/authorize';
import {
  buildingHistory,
  buildingInfo,
  buildingRail,
  historyEntryDetail,
  listBuildings,
  repeatDefects,
  syncBuilding,
  syncIfStale,
} from './buildingService';

export const buildingRouter = Router();

buildingRouter.get(
  '/',
  requirePermission('building.list', 'building.history.read', 'schedule.manage'),
  ah(async (req, res) => {
    const access = req.query.access === 'record' || req.query.access === 'manage' ? (req.query.access as 'record' | 'manage') : undefined;
    res.json(await listBuildings(req.auth!.userId, access));
  }),
);

buildingRouter.get(
  '/:buildingId',
  requirePermission('building.list', 'building.history.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.buildingId);
    await assertBuildingAccess(req, id, 'any');
    const b = await buildingInfo(id);
    if (!b) throw notFound('건물을 찾을 수 없습니다');
    res.json(b);
  }),
);

buildingRouter.get(
  '/:buildingId/rail',
  requirePermission('building.list', 'building.history.read', 'schedule.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.buildingId);
    await assertBuildingAccess(req, id, 'any');
    const r = await buildingRail(id);
    if (!r) throw notFound();
    res.json(r);
  }),
);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** FR-051 · FR-055 — 읽기 전용 */
buildingRouter.get(
  '/:buildingId/history',
  requirePermission('building.history.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.buildingId);
    await assertBuildingAccess(req, id, 'manage');
    const q = z
      .object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        defectType: z.string().max(20).optional(),
        kind: z.string().max(30).optional(),
      })
      .parse(req.query);
    syncIfStale(id);
    res.json(await buildingHistory(id, q));
  }),
);

buildingRouter.get(
  '/:buildingId/history/:kind/:sourceId',
  requirePermission('building.history.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.buildingId);
    await assertBuildingAccess(req, id, 'manage');
    const kind = req.params.kind;
    if (!['ai_analysis', 'field_record', 'expert_verdict', 'expert_connection', 'external'].includes(kind))
      throw badRequest('잘못된 이력 종류');
    const d = await historyEntryDetail(id, kind, idParam(req.params.sourceId));
    if (!d) throw notFound('이력을 찾을 수 없습니다');
    res.json(d);
  }),
);

buildingRouter.get(
  '/:buildingId/repeat-defects',
  requirePermission('building.history.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.buildingId);
    await assertBuildingAccess(req, id, 'manage');
    res.json(await repeatDefects(id));
  }),
);

buildingRouter.post(
  '/:buildingId/bms-sync',
  requirePermission('building.bms.sync'),
  ah(async (req, res) => {
    const id = idParam(req.params.buildingId);
    await assertBuildingAccess(req, id, 'manage');
    res.json(await syncBuilding(id));
  }),
);
