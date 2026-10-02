import express, { Router } from 'express';
import { z } from 'zod';
import { ah, idParam } from '../../lib/http';
import { requirePermission, requireSession } from '../../middleware/authorize';
import { idempotent } from '../../middleware/idempotency';
import { applyDecision, confirmPayment, createPayment, listPlans, myPayments, paymentDto } from './entitlementService';
import { paymentGateway } from '../../adapters/payment';
import { queryOne } from '../../db/pool';
import { linkGuest } from '../auth/guestLinkService';

export const planRouter = Router();
planRouter.get(
  '/',
  ah(async (_req, res) => {
    res.json(await listPlans());
  }),
);

export const paymentRouter = Router();

/** 웹훅: 인증·CSRF 제외, 서명 검증 (원문 본문 필요) */
paymentRouter.post(
  '/webhook',
  express.text({ type: '*/*' }),
  ah(async (req, res) => {
    const raw = (req as any).rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const evt = paymentGateway().parseWebhook(raw, req.get('X-PG-Signature'));
    if (!evt) {
      res.status(400).json({ code: 'bad_signature', message: '서명이 맞지 않습니다' });
      return;
    }
    const p = await queryOne<{ payment_id: number }>('SELECT payment_id FROM payment WHERE pg_tx_ref = ?', [evt.pgTxRef]);
    if (p) await applyDecision(p.payment_id, evt.approved, evt.declineReason);
    res.json({ ok: true });
  }),
);

paymentRouter.post(
  '/',
  requireSession(),
  requirePermission('entitlement.purchase'),
  idempotent,
  ah(async (req, res) => {
    const body = z.object({ planCode: z.enum(['per_analysis', 'monthly']) }).parse(req.body);
    res.status(201).json(await createPayment(req.auth!.userId, body.planCode));
  }),
);

paymentRouter.get(
  '/',
  requireSession(),
  requirePermission('entitlement.purchase'),
  ah(async (req, res) => {
    res.json(await myPayments(req.auth!.userId));
  }),
);

paymentRouter.get(
  '/:paymentId',
  requireSession(),
  requirePermission('entitlement.purchase'),
  ah(async (req, res) => {
    res.json(await paymentDto(idParam(req.params.paymentId), req.auth!.userId));
  }),
);

paymentRouter.post(
  '/:paymentId/confirm',
  requireSession(),
  requirePermission('entitlement.purchase'),
  idempotent,
  ah(async (req, res) => {
    const body = z.object({ cardNumber: z.string().max(25).optional() }).parse(req.body ?? {});
    const dto = await confirmPayment(req.auth!.userId, idParam(req.params.paymentId), body);
    res.status(dto.status === 'declined' ? 402 : 200).json(dto);
  }),
);

/** FR-120a — 이 기기의 비회원 분석 결과를 계정에 연결 */
export const linkGuestRouter = Router();
linkGuestRouter.post(
  '/',
  requireSession(),
  requirePermission('guest.link'),
  ah(async (req, res) => {
    res.json(await linkGuest(req.auth!.userId, req.deviceTokenHash));
  }),
);
