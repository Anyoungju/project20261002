import { Router } from 'express';
import { z } from 'zod';
import { ah, idParam, notFound } from '../../lib/http';
import { requirePermission, assertBuildingAccess } from '../../middleware/authorize';
import { idempotent } from '../../middleware/idempotency';
import {
  attemptDetail,
  candidates,
  confirm,
  createRequest,
  dismissRiskNotice,
  expertInbox,
  listRiskNotices,
  myRequests,
  preview,
  requestBuildingId,
  requestDetail,
  respond,
  updateConditions,
} from './expertService';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const specialty = z.enum(['architecture', 'structure', 'waterproof']);

export const riskNoticeRouter = Router();
riskNoticeRouter.get(
  '/',
  requirePermission('risk_notice.read'),
  ah(async (req, res) => {
    res.json(await listRiskNotices(req.auth!.userId, req.query.all === '1'));
  }),
);
riskNoticeRouter.post(
  '/:riskNoticeId/dismiss',
  requirePermission('risk_notice.dismiss'),
  ah(async (req, res) => {
    await dismissRiskNotice(req.auth!.userId, idParam(req.params.riskNoticeId));
    res.json({ ok: true });
  }),
);

export const expertRequestRouter = Router();

async function guard(req: any, id: number) {
  const b = await requestBuildingId(id);
  if (!b) throw notFound('요청을 찾을 수 없습니다');
  await assertBuildingAccess(req, b, 'manage');
}

expertRequestRouter.get(
  '/',
  requirePermission('expert_request.create'),
  ah(async (req, res) => {
    res.json(await myRequests(req.auth!.userId));
  }),
);

expertRequestRouter.post(
  '/',
  requirePermission('expert_request.create'),
  ah(async (req, res) => {
    const body = z
      .object({
        caseId: z.number().int().positive(),
        riskNoticeId: z.number().int().positive().nullable().optional(),
        originKind: z.enum(['analysis', 'verdict', 'inspection', 'history', 'priority', 'direct']).optional(),
        specialtyCode: specialty,
        wishFrom: date,
        wishTo: date,
      })
      .parse(req.body);
    const id = await createRequest(req.auth!.userId, body);
    res.status(201).json(await requestDetail(id));
  }),
);

expertRequestRouter.get(
  '/:expReqId',
  requirePermission('expert_request.create'),
  ah(async (req, res) => {
    const id = idParam(req.params.expReqId);
    await guard(req, id);
    res.json(await requestDetail(id));
  }),
);

expertRequestRouter.patch(
  '/:expReqId',
  requirePermission('expert_request.create'),
  ah(async (req, res) => {
    const id = idParam(req.params.expReqId);
    await guard(req, id);
    const body = z.object({ specialtyCode: specialty.optional(), wishFrom: date.optional(), wishTo: date.optional() }).parse(req.body);
    await updateConditions(id, body);
    res.json(await requestDetail(id));
  }),
);

expertRequestRouter.get(
  '/:expReqId/candidates',
  requirePermission('expert_request.create'),
  ah(async (req, res) => {
    const id = idParam(req.params.expReqId);
    await guard(req, id);
    res.json(await candidates(id));
  }),
);

expertRequestRouter.get(
  '/:expReqId/preview',
  requirePermission('expert_request.create'),
  ah(async (req, res) => {
    const id = idParam(req.params.expReqId);
    await guard(req, id);
    res.json(await preview(id, idParam(req.query.expertId)));
  }),
);

expertRequestRouter.post(
  '/:expReqId/confirm',
  requirePermission('expert_request.create'),
  idempotent,
  ah(async (req, res) => {
    const id = idParam(req.params.expReqId);
    await guard(req, id);
    const body = z
      .object({
        expertId: z.number().int().positive(),
        consent: z.boolean(),
        scopeText: z.string().max(500).default(''),
        noticeId: z.number().int().default(0),
      })
      .parse(req.body);
    await confirm(id, req.auth!.userId, body);
    res.json(await requestDetail(id));
  }),
);

export const expertAttemptRouter = Router();
expertAttemptRouter.get(
  '/:attemptId',
  requirePermission('expert_attempt.respond'),
  ah(async (req, res) => {
    const d = await attemptDetail(idParam(req.params.attemptId), req.auth!.userId);
    if (!d) throw notFound('요청을 찾을 수 없습니다');
    res.json(d);
  }),
);
expertAttemptRouter.post(
  '/:attemptId/respond',
  requirePermission('expert_attempt.respond'),
  idempotent,
  ah(async (req, res) => {
    const id = idParam(req.params.attemptId);
    const body = z
      .object({ response: z.enum(['accepted', 'declined']), declineReason: z.string().max(200).nullable().optional() })
      .parse(req.body);
    await respond(id, req.auth!.userId, body.response, body.declineReason);
    res.json(await attemptDetail(id, req.auth!.userId));
  }),
);

export const myExpertAttemptsRouter = Router();
myExpertAttemptsRouter.get(
  '/',
  requirePermission('expert_attempt.respond'),
  ah(async (req, res) => {
    res.json(await expertInbox(req.auth!.userId));
  }),
);
