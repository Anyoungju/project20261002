import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ah, idParam, notFound } from '../../lib/http';
import { requirePermission, assertBuildingAccess } from '../../middleware/authorize';
import { idempotent } from '../../middleware/idempotency';
import {
  addPhotos,
  createDraft,
  linkableResults,
  myRecords,
  patchDraft,
  recordBuildingId,
  recordDto,
  saveRecord,
  updateRepairStatus,
} from './recordService';
import { completeScheduleWithRecord } from '../schedule/scheduleService';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

export const recordRouter = Router();

const fields = z.object({
  locationText: z.string().max(200).nullable().optional(),
  defectTypeCode: z.string().max(20).nullable().optional(),
  repairStatus: z.enum(['completed', 'pending']).nullable().optional(),
  repairMethod: z.string().max(200).nullable().optional(),
  inspectionNote: z.string().max(1000).nullable().optional(),
  aiMatch: z.enum(['match', 'mismatch', 'none']).nullable().optional(),
  riskFlag: z.boolean().optional(),
});

async function guardRecord(req: any, recordId: number) {
  const b = await recordBuildingId(recordId);
  if (!b) throw notFound('기록을 찾을 수 없습니다');
  await assertBuildingAccess(req, b, 'record');
}

recordRouter.get(
  '/',
  requirePermission('record.create'),
  ah(async (req, res) => {
    const status = req.query.status === 'draft' || req.query.status === 'saved' ? (req.query.status as any) : undefined;
    res.json(await myRecords(req.auth!.userId, status));
  }),
);

recordRouter.get(
  '/linkable-results',
  requirePermission('record.create'),
  ah(async (req, res) => {
    const b = idParam(req.query.buildingId);
    await assertBuildingAccess(req, b, 'record');
    res.json(await linkableResults(req.auth!.userId, b));
  }),
);

recordRouter.post(
  '/',
  requirePermission('record.create'),
  ah(async (req, res) => {
    const body = z
      .object({ buildingId: z.number().int().positive(), resultId: z.number().int().positive().nullable().optional() })
      .parse(req.body);
    await assertBuildingAccess(req, body.buildingId, 'record');
    const id = await createDraft(req.auth!.userId, body.buildingId, body.resultId ?? null);
    res.status(201).json(await recordDto(id));
  }),
);

recordRouter.get(
  '/:recordId',
  requirePermission('record.create'),
  ah(async (req, res) => {
    const id = idParam(req.params.recordId);
    await guardRecord(req, id);
    res.json(await recordDto(id));
  }),
);

recordRouter.patch(
  '/:recordId',
  requirePermission('record.create'),
  ah(async (req, res) => {
    const id = idParam(req.params.recordId);
    await guardRecord(req, id);
    await patchDraft(id, req.auth!.userId, fields.parse(req.body));
    res.json(await recordDto(id));
  }),
);

recordRouter.post(
  '/:recordId/photos',
  requirePermission('record.create'),
  upload.array('photos', 10),
  ah(async (req, res) => {
    const id = idParam(req.params.recordId);
    await guardRecord(req, id);
    const files = ((req.files as Express.Multer.File[]) ?? []).map((f) => ({ buffer: f.buffer, mimetype: f.mimetype }));
    await addPhotos(id, req.auth!.userId, files);
    res.status(201).json(await recordDto(id));
  }),
);

recordRouter.post(
  '/:recordId/save',
  requirePermission('record.create'),
  idempotent,
  ah(async (req, res) => {
    const id = idParam(req.params.recordId);
    await guardRecord(req, id);
    const body = z.object({ scheduleId: z.number().int().positive().optional() }).parse(req.body ?? {});
    await saveRecord(id, req.auth!.userId);
    let schedule = null;
    if (body.scheduleId) schedule = await completeScheduleWithRecord(body.scheduleId, id, req.auth!.userId);
    res.json({ ...(await recordDto(id)), completedScheduleId: schedule?.scheduleId ?? null });
  }),
);

recordRouter.patch(
  '/:recordId/repair-status',
  requirePermission('record.repair.update'),
  ah(async (req, res) => {
    const id = idParam(req.params.recordId);
    await guardRecord(req, id);
    const body = z
      .object({ repairStatus: z.enum(['completed', 'pending']), repairMethod: z.string().max(200).nullable().optional() })
      .parse(req.body);
    await updateRepairStatus(id, req.auth!.userId, body.repairStatus, body.repairMethod);
    res.json(await recordDto(id));
  }),
);
