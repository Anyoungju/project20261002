import { Router } from 'express';
import { z } from 'zod';
import { ah, idParam, notFound } from '../../lib/http';
import { requirePermission, assertBuildingAccess } from '../../middleware/authorize';
import {
  assigneeCandidates,
  cancelSchedule,
  completeScheduleWithRecord,
  createSchedule,
  listSchedules,
  myAssignments,
  scheduleBuildingId,
  updateSchedule,
} from './scheduleService';
import { buildingRail } from '../building/buildingService';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식은 YYYY-MM-DD');
const cycle = z.enum(['month', 'quarter', 'half', 'year']);

/** /api/buildings/:buildingId/schedules */
export const buildingScheduleRouter = Router({ mergeParams: true });

buildingScheduleRouter.get(
  '/',
  requirePermission('schedule.manage'),
  ah(async (req, res) => {
    const b = idParam(req.params.buildingId);
    await assertBuildingAccess(req, b, 'manage');
    const [rail, schedules, assignees] = await Promise.all([buildingRail(b), listSchedules(b), assigneeCandidates(b)]);
    res.json({ rail, schedules, assignees });
  }),
);

buildingScheduleRouter.post(
  '/',
  requirePermission('schedule.manage'),
  ah(async (req, res) => {
    const b = idParam(req.params.buildingId);
    await assertBuildingAccess(req, b, 'manage');
    const body = z
      .object({
        itemText: z.string().trim().min(2).max(200),
        cycleCode: cycle.nullable().optional(),
        assigneeId: z.number().int().positive(),
        dueDate: date,
      })
      .parse(req.body);
    const id = await createSchedule(req.auth!.userId, b, body);
    res.status(201).json({ scheduleId: id, schedules: await listSchedules(b) });
  }),
);

export const scheduleRouter = Router();

async function guard(req: any, id: number) {
  const b = await scheduleBuildingId(id);
  if (!b) throw notFound('일정을 찾을 수 없습니다');
  await assertBuildingAccess(req, b, 'manage');
  return b;
}

scheduleRouter.patch(
  '/:scheduleId',
  requirePermission('schedule.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.scheduleId);
    const b = await guard(req, id);
    const body = z
      .object({
        itemText: z.string().trim().min(2).max(200).optional(),
        cycleCode: cycle.nullable().optional(),
        assigneeId: z.number().int().positive().optional(),
        dueDate: date.optional(),
      })
      .parse(req.body);
    await updateSchedule(id, body);
    res.json({ schedules: await listSchedules(b) });
  }),
);

scheduleRouter.post(
  '/:scheduleId/cancel',
  requirePermission('schedule.manage'),
  ah(async (req, res) => {
    const id = idParam(req.params.scheduleId);
    const b = await guard(req, id);
    await cancelSchedule(id);
    res.json({ schedules: await listSchedules(b) });
  }),
);

/** 담당 시설관리자(기록 권한) 또는 관리자 */
scheduleRouter.post(
  '/:scheduleId/complete',
  requirePermission('schedule.manage', 'schedule.read.assigned'),
  ah(async (req, res) => {
    const id = idParam(req.params.scheduleId);
    const b = await scheduleBuildingId(id);
    if (!b) throw notFound('일정을 찾을 수 없습니다');
    await assertBuildingAccess(req, b, ['record', 'manage']);
    const body = z.object({ recordId: z.number().int().positive() }).parse(req.body);
    await completeScheduleWithRecord(id, body.recordId, req.auth!.userId);
    res.json({ ok: true });
  }),
);

export const assignmentRouter = Router();
assignmentRouter.get(
  '/',
  requirePermission('schedule.read.assigned'),
  ah(async (req, res) => {
    res.json(await myAssignments(req.auth!.userId));
  }),
);
