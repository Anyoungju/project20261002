import { Router } from 'express';
import { z } from 'zod';
import { ah, idParam, notFound } from '../../lib/http';
import { requirePermission } from '../../middleware/authorize';
import { idempotent } from '../../middleware/idempotency';
import { itemDetail, queue, requestData, saveVerdict, trustMetrics } from './verificationService';

export const verificationRouter = Router();

verificationRouter.get(
  '/',
  requirePermission('verification.read'),
  ah(async (req, res) => {
    const q = z
      .object({ defectType: z.string().max(20).optional(), status: z.enum(['waiting', 'data_requested', 'verified']).optional() })
      .parse(req.query);
    res.json(await queue(q));
  }),
);

verificationRouter.get(
  '/:itemId',
  requirePermission('verification.read'),
  ah(async (req, res) => {
    const d = await itemDetail(idParam(req.params.itemId));
    if (!d) throw notFound('검증 대상을 찾을 수 없습니다');
    res.json(d);
  }),
);

verificationRouter.post(
  '/:itemId/verdicts',
  requirePermission('verification.judge'),
  idempotent,
  ah(async (req, res) => {
    const id = idParam(req.params.itemId);
    const body = z
      .object({
        verdict: z.enum(['match', 'mismatch']),
        opinion: z.string().max(1000).nullable().optional(),
        diffNote: z.string().max(500).nullable().optional(),
        riskHigh: z.boolean().optional(),
      })
      .parse(req.body);
    await saveVerdict(id, req.auth!.userId, body);
    res.status(201).json(await itemDetail(id));
  }),
);

verificationRouter.post(
  '/:itemId/data-requests',
  requirePermission('verification.request_data'),
  ah(async (req, res) => {
    const id = idParam(req.params.itemId);
    const body = z.object({ reason: z.string().trim().min(2).max(200) }).parse(req.body);
    await requestData(id, req.auth!.userId, body.reason);
    res.status(201).json(await itemDetail(id));
  }),
);

export const trustRouter = Router();
trustRouter.get(
  '/',
  requirePermission('trust_metric.read', 'org.dashboard.read'),
  ah(async (_req, res) => {
    res.json(await trustMetrics());
  }),
);
