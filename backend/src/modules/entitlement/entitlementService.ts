import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { paymentGateway } from '../../adapters/payment';
import { gateError, releaseGates } from '../../gates/gateBlock';
import { HttpError, notFound } from '../../lib/http';

export interface PlanDto {
  planCode: 'per_analysis' | 'monthly';
  planName: string;
  priceAmount: number | null;
  analysisQuota: number | null;
  periodMonths: number | null;
  purchasable: boolean;
  conditionText: string;
}

export async function listPlans(): Promise<PlanDto[]> {
  const rows = await query<{
    plan_code: any;
    plan_name: string;
    price_amount: number | null;
    analysis_quota: number | null;
    period_months: number | null;
  }>(
    "SELECT plan_code, plan_name, price_amount, analysis_quota, period_months FROM service_plan ORDER BY FIELD(plan_code, 'per_analysis', 'monthly')",
  );
  return rows.map((p) => ({
    planCode: p.plan_code,
    planName: p.plan_name,
    priceAmount: p.price_amount == null ? null : Number(p.price_amount),
    analysisQuota: p.analysis_quota,
    periodMonths: p.period_months,
    // R11 — 금액 미설정이면 결제 불가(보수적 동작)
    purchasable: p.price_amount != null,
    conditionText:
      p.plan_code === 'per_analysis'
        ? `분석 ${p.analysis_quota}회 · 기간 제한 없음 · 분석 실패·품질 부적합은 차감하지 않음`
        : `결제일부터 ${p.period_months}개월 · 기간 내 분석 횟수 제한 없음 · 만료 후 자동 갱신 없음`,
  }));
}

/** FR-022 — 결제 금액은 시점 값으로 고정 */
export async function createPayment(userId: number, planCode: string) {
  const plan = (await listPlans()).find((p) => p.planCode === planCode);
  if (!plan) throw notFound('요금제를 찾을 수 없습니다');
  if (!plan.purchasable) throw new HttpError(409, 'plan_price_unset', '이 요금제는 아직 금액이 설정되지 않아 구매할 수 없습니다');
  const r = await exec('INSERT INTO payment (user_id, plan_code, amount) VALUES (?, ?, ?)', [userId, planCode, plan.priceAmount]);
  const co = await paymentGateway().createCheckout(r.insertId, plan.priceAmount!);
  await exec('UPDATE payment SET pg_tx_ref = ? WHERE payment_id = ?', [co.pgTxRef, r.insertId]);
  return { paymentId: r.insertId, amount: plan.priceAmount, planCode, checkout: co };
}

/**
 * FR-021 — PG 승인 확인 뒤 한 트랜잭션에서 approved + 이용권. uq_entitlement_payment 가 1결제 1이용권 보장.
 * 이미 결정된 결제는 같은 결과를 돌려준다(멱등).
 */
export async function confirmPayment(userId: number, paymentId: number, payload: { cardNumber?: string }) {
  const p = await queryOne<{
    payment_id: number;
    user_id: number;
    plan_code: string;
    pay_status: string;
    decline_reason: string | null;
    pg_tx_ref: string | null;
  }>('SELECT payment_id, user_id, plan_code, pay_status, decline_reason, pg_tx_ref FROM payment WHERE payment_id = ?', [paymentId]);
  if (!p || p.user_id !== userId) throw notFound('결제를 찾을 수 없습니다');
  if (p.pay_status === 'requested') {
    const result = await paymentGateway().confirm(p.pg_tx_ref ?? '', payload);
    await applyDecision(paymentId, result.approved, result.declineReason);
  }
  return paymentDto(paymentId, userId);
}

export async function applyDecision(paymentId: number, approved: boolean, declineReason?: string) {
  await withTransaction(async (conn) => {
    const p = await queryOne<{ user_id: number; plan_code: string; pay_status: string }>(
      'SELECT user_id, plan_code, pay_status FROM payment WHERE payment_id = ? FOR UPDATE',
      [paymentId],
      conn,
    );
    if (!p || p.pay_status !== 'requested') return; // 이미 결정됨
    if (!approved) {
      await exec(
        "UPDATE payment SET pay_status = 'declined', decline_reason = ?, decided_at = CURRENT_TIMESTAMP WHERE payment_id = ?",
        [(declineReason ?? '결제 수단이 거절되었습니다').slice(0, 200), paymentId],
        conn,
      );
      return;
    }
    await exec("UPDATE payment SET pay_status = 'approved', decided_at = CURRENT_TIMESTAMP WHERE payment_id = ?", [paymentId], conn);
    const plan = await queryOne<{ analysis_quota: number | null; period_months: number | null }>(
      'SELECT analysis_quota, period_months FROM service_plan WHERE plan_code = ?',
      [p.plan_code],
      conn,
    );
    if (p.plan_code === 'monthly') {
      await exec(
        "INSERT INTO entitlement (user_id, ent_kind, payment_id, quota_total, valid_until) VALUES (?, 'monthly', ?, NULL, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MONTH))",
        [p.user_id, paymentId, plan?.period_months ?? 1],
        conn,
      );
    } else {
      await exec(
        "INSERT INTO entitlement (user_id, ent_kind, payment_id, quota_total) VALUES (?, 'per_analysis', ?, ?)",
        [p.user_id, paymentId, plan?.analysis_quota ?? 1],
        conn,
      );
    }
    // G2 해제 기록 (FR-007)
    await releaseGates({ kind: 'user_account', id: p.user_id }, 'G2', p.user_id, 'purchase', conn);
  });
}

export async function paymentDto(paymentId: number, userId: number) {
  const p = await queryOne<{
    payment_id: number;
    plan_code: string;
    amount: number | null;
    pay_status: string;
    decline_reason: string | null;
    requested_at: string;
    decided_at: string | null;
  }>(
    'SELECT payment_id, plan_code, amount, pay_status, decline_reason, requested_at, decided_at FROM payment WHERE payment_id = ? AND user_id = ?',
    [paymentId, userId],
  );
  if (!p) throw notFound('결제를 찾을 수 없습니다');
  const ent = await queryOne<{ entitlement_id: number; ent_kind: string; quota_total: number | null; valid_until: string | null }>(
    'SELECT entitlement_id, ent_kind, quota_total, valid_until FROM entitlement WHERE payment_id = ?',
    [paymentId],
  );
  const base = {
    paymentId: p.payment_id,
    planCode: p.plan_code,
    amount: p.amount == null ? null : Number(p.amount),
    status: p.pay_status,
    declineReason: p.decline_reason,
    requestedAt: p.requested_at,
    decidedAt: p.decided_at,
    entitlement: ent
      ? { entitlementId: ent.entitlement_id, kind: ent.ent_kind, quotaTotal: ent.quota_total, validUntil: ent.valid_until }
      : null,
  };
  if (p.pay_status === 'declined') {
    // G1 — 같은 결제를 여러 번 조회해도 gate_event 는 한 번
    const exists = await queryOne("SELECT 1 AS x FROM gate_event WHERE gate_code = 'G1' AND subject_kind = 'payment' AND subject_id = ?", [
      paymentId,
    ]);
    const err = await gateError('G1', {
      reason: p.decline_reason ?? undefined,
      actorId: userId,
      subject: { kind: 'payment', id: paymentId },
      record: !exists,
      actions: [{ id: 'retry-payment', label: '결제 정보 바꿔 다시 시도' }],
    });
    return { ...base, gate: err.block };
  }
  return { ...base, gate: null };
}

export async function myPayments(userId: number) {
  const rows = await query<{
    payment_id: number;
    plan_code: string;
    amount: number | null;
    pay_status: string;
    decline_reason: string | null;
    requested_at: string;
  }>(
    'SELECT payment_id, plan_code, amount, pay_status, decline_reason, requested_at FROM payment WHERE user_id = ? ORDER BY payment_id DESC LIMIT 20',
    [userId],
  );
  return rows.map((p) => ({
    paymentId: p.payment_id,
    planCode: p.plan_code,
    amount: p.amount == null ? null : Number(p.amount),
    status: p.pay_status,
    declineReason: p.decline_reason,
    requestedAt: p.requested_at,
  }));
}
