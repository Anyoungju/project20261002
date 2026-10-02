import { Router, Request } from 'express';
import { z } from 'zod';
import { ah, idParam, notFound, badRequest } from '../../lib/http';
import { requirePermission, assertOrgScope } from '../../middleware/authorize';
import { idempotent } from '../../middleware/idempotency';
import { assignAction, assertLicense, createRun, dashboard, runDetail, runOrgId } from './priorityService';

function orgOf(req: Request): number {
  const q = req.query.orgId ? Number(req.query.orgId) : null;
  if (q && req.auth!.roles.includes('operator')) return q;
  if (!req.auth!.orgId) throw badRequest('소속 조직이 없습니다', 'no_org');
  return req.auth!.orgId;
}

export const orgRouter = Router();
orgRouter.get(
  '/dashboard',
  requirePermission('org.dashboard.read'),
  ah(async (req, res) => {
    const org = orgOf(req);
    await assertOrgScope(req, org);
    res.json(await dashboard(org, req.auth!.userId));
  }),
);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const priorityRouter = Router();
priorityRouter.post(
  '/',
  requirePermission('priority.run'),
  idempotent,
  ah(async (req, res) => {
    const org = orgOf(req);
    await assertOrgScope(req, org);
    const body = z
      .object({ buildingIds: z.array(z.number().int().positive()).min(1).max(200), periodFrom: date, periodTo: date })
      .parse(req.body);
    const id = await createRun(org, req.auth!.userId, body.buildingIds, body.periodFrom, body.periodTo);
    res.status(201).json(await runDetail(id));
  }),
);

priorityRouter.get(
  '/:runId',
  requirePermission('priority.run', 'org.dashboard.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.runId);
    const org = await runOrgId(id);
    if (!org) throw notFound('산출 결과를 찾을 수 없습니다');
    await assertOrgScope(req, org);
    await assertLicense(org, req.auth!.userId);
    res.json(await runDetail(id));
  }),
);

priorityRouter.patch(
  '/:runId/items/:rank',
  requirePermission('priority.run'),
  ah(async (req, res) => {
    const id = idParam(req.params.runId);
    const org = await runOrgId(id);
    if (!org) throw notFound('산출 결과를 찾을 수 없습니다');
    await assertOrgScope(req, org);
    const body = z.object({ action: z.enum(['inspection', 'expert']).nullable() }).parse(req.body);
    await assignAction(id, idParam(req.params.rank), body.action);
    res.json(await runDetail(id));
  }),
);
