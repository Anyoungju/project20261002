import { Router } from 'express';
import { z } from 'zod';
import { ah, idParam, notFound } from '../../lib/http';
import { requirePermission } from '../../middleware/authorize';
import * as svc from './adminService';

/** research R22 · tasks Phase 5 — 계정·역할·건물 권한·권한 요청·매트릭스·감사 로그·기준값·고지 */
export const adminRouter = Router();

const roles = z.array(z.string()).max(10);

adminRouter.get(
  '/users',
  requirePermission('admin.users.manage', 'building_access.grant'),
  ah(async (req, res) => {
    const q = z
      .object({ role: z.string().optional(), q: z.string().max(50).optional(), status: z.enum(['active', 'disabled']).optional() })
      .parse(req.query);
    res.json(await svc.listUsers(req.auth!, q));
  }),
);

adminRouter.post(
  '/users',
  requirePermission('admin.users.manage'),
  ah(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        displayName: z.string().trim().min(1).max(50),
        phone: z.string().max(20).nullable().optional(),
        orgId: z.number().int().positive().nullable().optional(),
        roles,
      })
      .parse(req.body);
    res.status(201).json(await svc.createUser(req.auth!, body));
  }),
);

adminRouter.get(
  '/users/:userId',
  requirePermission('admin.users.manage', 'building_access.grant'),
  ah(async (req, res) => {
    const d = await svc.userDetail(idParam(req.params.userId));
    if (!d) throw notFound('사용자를 찾을 수 없습니다');
    res.json(d);
  }),
);

adminRouter.patch(
  '/users/:userId',
  requirePermission('admin.users.manage'),
  ah(async (req, res) => {
    const body = z.object({ disabled: z.boolean() }).parse(req.body);
    res.json(await svc.setDisabled(req.auth!, idParam(req.params.userId), body.disabled));
  }),
);

adminRouter.put(
  '/users/:userId/roles',
  requirePermission('admin.users.manage'),
  ah(async (req, res) => {
    const body = z.object({ roles }).parse(req.body);
    res.json(await svc.setRoles(req.auth!, idParam(req.params.userId), body.roles));
  }),
);

adminRouter.post(
  '/users/:userId/reset-password',
  requirePermission('admin.users.manage'),
  ah(async (req, res) => {
    res.json(await svc.resetPassword(req.auth!, idParam(req.params.userId)));
  }),
);

const access = z.object({ buildingId: z.number().int().positive(), accessKind: z.enum(['record', 'manage']) });

adminRouter.post(
  '/users/:userId/building-access',
  requirePermission('building_access.grant'),
  ah(async (req, res) => {
    const body = access.parse(req.body);
    const id = idParam(req.params.userId);
    await svc.grantAccess(req.auth!, id, body.buildingId, body.accessKind);
    res.status(201).json(await svc.userDetail(id));
  }),
);

adminRouter.delete(
  '/users/:userId/building-access',
  requirePermission('building_access.grant'),
  ah(async (req, res) => {
    const body = access.parse({ buildingId: Number(req.query.buildingId), accessKind: req.query.accessKind });
    const id = idParam(req.params.userId);
    await svc.revokeAccess(req.auth!, id, body.buildingId, body.accessKind);
    res.json(await svc.userDetail(id));
  }),
);

adminRouter.get(
  '/permission-requests',
  requirePermission('permission_request.resolve'),
  ah(async (req, res) => {
    res.json(await svc.listPermissionRequests(req.auth!, req.query.status === 'all' ? 'all' : 'pending'));
  }),
);

adminRouter.post(
  '/permission-requests/:permReqId',
  requirePermission('permission_request.resolve'),
  ah(async (req, res) => {
    const body = z
      .object({ resolution: z.enum(['granted', 'rejected']), accessKind: z.enum(['record', 'manage']).optional() })
      .parse(req.body);
    await svc.resolvePermissionRequest(req.auth!, idParam(req.params.permReqId), body.resolution, body.accessKind);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/rbac/matrix',
  requirePermission('admin.rbac.manage', 'admin.users.manage', 'building_access.grant'),
  ah(async (_req, res) => {
    res.json(await svc.matrix());
  }),
);

adminRouter.put(
  '/rbac/roles/:role/permissions',
  requirePermission('admin.rbac.manage'),
  ah(async (req, res) => {
    const body = z.object({ permissions: z.array(z.string()).max(100) }).parse(req.body);
    res.json(await svc.setRolePermissions(req.auth!, req.params.role, body.permissions));
  }),
);

adminRouter.get(
  '/audit-log',
  requirePermission('admin.users.manage', 'building_access.grant'),
  ah(async (req, res) => {
    res.json(await svc.auditLog(req.auth!));
  }),
);

adminRouter.get(
  '/gate-events',
  requirePermission('gate_event.read'),
  ah(async (_req, res) => {
    res.json(await svc.gateEvents());
  }),
);

adminRouter.get(
  '/scope',
  requirePermission('admin.users.manage', 'building_access.grant'),
  ah(async (req, res) => {
    res.json(await svc.orgsAndBuildings(req.auth!));
  }),
);

adminRouter.get(
  '/constants',
  requirePermission('admin.constants.manage', 'admin.notices.manage'),
  ah(async (_req, res) => {
    res.json({ constants: await svc.constants(), plans: await svc.plansAdmin() });
  }),
);

adminRouter.put(
  '/constants/:key',
  requirePermission('admin.constants.manage'),
  ah(async (req, res) => {
    const body = z.object({ value: z.string().max(100).nullable() }).parse(req.body);
    res.json(await svc.setConstant(req.auth!, req.params.key, body.value));
  }),
);

adminRouter.put(
  '/plans/:planCode/price',
  requirePermission('admin.constants.manage'),
  ah(async (req, res) => {
    const body = z.object({ priceAmount: z.number().int().min(0).nullable() }).parse(req.body);
    await svc.setPlanPrice(req.auth!, req.params.planCode, body.priceAmount);
    res.json(await svc.plansAdmin());
  }),
);

adminRouter.get(
  '/notices',
  requirePermission('admin.notices.manage'),
  ah(async (_req, res) => {
    res.json(await svc.notices());
  }),
);

adminRouter.post(
  '/notices',
  requirePermission('admin.notices.manage'),
  ah(async (req, res) => {
    const body = z.object({ kind: z.enum(['analysis', 'priority', 'share']), body: z.string().trim().min(10).max(1000) }).parse(req.body);
    res.status(201).json(await svc.addNotice(req.auth!, body.kind, body.body));
  }),
);
