import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ah, idParam, notFound } from '../../lib/http';
import { requirePermission, assertBuildingAccess, assertCaseAccess, loginRequired } from '../../middleware/authorize';
import { idempotent } from '../../middleware/idempotency';
import { ensureGuest, ensureFreeTrial } from '../auth/guestLinkService';
import { entitlementStatus, myCases, requestDto, retryAnalysis, submitAnalysis } from './analysisService';
import { queryOne } from '../../db/pool';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

export const analysisRouter = Router();

/** 비회원은 기기 계정을 만든 뒤 RBAC(guest) 를 그대로 적용한다 (FR-120) */
analysisRouter.post(
  '/',
  ah(async (req, res, next) => {
    if (!req.auth) await ensureGuest(req, res);
    next();
  }),
  requirePermission('analysis.create'),
  idempotent,
  upload.array('photos', 10),
  ah(async (req, res) => {
    const body = z
      .object({
        description: z.string().max(500).optional().nullable(),
        caseId: z.coerce.number().int().positive().optional(),
        buildingId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body ?? {});
    if (body.buildingId) await assertBuildingAccess(req, body.buildingId, ['record', 'manage']);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const { requestId } = await submitAnalysis({
      userId: req.auth!.userId,
      isGuest: req.auth!.isGuest,
      description: body.description?.trim() || null,
      photos: files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname })),
      caseId: body.caseId ?? null,
      buildingId: body.buildingId ?? null,
    });
    res.status(201).json(await requestDto(requestId));
  }),
);

analysisRouter.get(
  '/:requestId',
  requirePermission('analysis.read.own', 'case.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.requestId);
    const r = await queryOne<{ case_id: number }>('SELECT case_id FROM analysis_request WHERE request_id = ?', [id]);
    if (!r) throw notFound('분석 요청을 찾을 수 없습니다');
    await assertCaseAccess(req, r.case_id);
    res.json(await requestDto(id));
  }),
);

analysisRouter.post(
  '/:requestId/retry',
  requirePermission('analysis.create'),
  idempotent,
  ah(async (req, res) => {
    const { requestId } = await retryAnalysis(idParam(req.params.requestId), req.auth!.userId, req.auth!.isGuest);
    res.status(201).json(await requestDto(requestId));
  }),
);

export const meRouter = Router();

meRouter.get(
  '/entitlements',
  ah(async (req, res) => {
    if (!req.auth) {
      // 아직 기기가 없는 비회원: 첫 분석 시 발급될 체험 횟수만 알려준다
      const n = await queryOne<{ const_value: string | null }>(
        "SELECT const_value FROM service_constant WHERE const_key = 'free_trial_count'",
      );
      const total = n?.const_value ? parseInt(n.const_value, 10) : 0;
      res.json({ isGuest: true, eligible: total > 0, freeTrial: total ? { total, used: 0, remaining: total } : null, paid: [] });
      return;
    }
    if (!req.auth.permissions.has('entitlement.read.own')) throw await loginRequired(req);
    if (!req.auth.isGuest) await ensureFreeTrial(req.auth.userId);
    res.json(await entitlementStatus(req.auth.userId, req.auth.isGuest));
  }),
);

meRouter.get(
  '/cases',
  requirePermission('analysis.read.own'),
  ah(async (req, res) => {
    res.json(await myCases(req.auth!.userId));
  }),
);
