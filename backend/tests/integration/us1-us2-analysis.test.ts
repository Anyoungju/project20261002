import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedFixture, done, as, getApp, Client, photo, waitAnalysis, Fixture } from './helpers';
import { setAiAnalyzer, MockAnalyzer, AiAnalyzer } from '../../src/adapters/ai';
import { query, queryOne, exec } from '../../src/db/pool';

let fx: Fixture;
const guests: number[] = [];
let aiCalls = 0;
beforeAll(async () => {
  fx = await seedFixture();
  const mock = new MockAnalyzer();
  const counting: AiAnalyzer = { name: 'count', analyze: (i) => (aiCalls++, mock.analyze(i)) };
  setAiAnalyzer(counting);
});
afterAll(() => done(guests));

describe('US1 하자 사진 AI 분석', () => {
  it('정상 요청 → 원인·대응방안 + 고지 판본 포함(SC-003), 체험 1회 차감', async () => {
    const c = await as('general');
    const before = (await c.get('/api/me/entitlements')).body.freeTrial.remaining;
    const r = await c.upload('/api/analysis-requests', [await photo('crack')], { description: '벽 균열 #normal' });
    expect(r.status).toBe(201);
    const d = (await waitAnalysis(c, r.body.requestId)).body;
    expect(d.status).toBe('completed');
    expect(d.result.notice.noticeId).toBeGreaterThan(0);
    expect(d.result.notice.body).toContain('1차 참고용');
    expect(d.result.causes.length).toBeGreaterThan(0);
    expect((await c.get('/api/me/entitlements')).body.freeTrial.remaining).toBe(before - 1);
  });

  it('위험·신뢰도 낮음 결과는 100% 권고(SC-004), 위험 통지 생성', async () => {
    const c = await as('general');
    for (const tag of ['#danger', '#lowconf']) {
      const r = await c.upload('/api/analysis-requests', [await photo('leak')], { description: tag });
      const d = (await waitAnalysis(c, r.body.requestId)).body;
      expect(d.result.recommendExpert).toBe(true);
      if (tag === '#danger') {
        const n = await queryOne('SELECT COUNT(*) AS n FROM risk_notice WHERE result_id = ?', [d.result.resultId]);
        expect(Number(n!.n)).toBe(1);
      }
    }
  });

  it('G3 품질 부적합 — AI 미호출·이용권 미소진(SC-005)', async () => {
    const c = await as('general2');
    const before = (await c.get('/api/me/entitlements')).body.freeTrial.remaining;
    const calls = aiCalls;
    const r = await c.upload('/api/analysis-requests', [await photo('crack', 'dark')]);
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('G3');
    expect(r.body.actions[0].id).toBe('retry-upload');
    expect(aiCalls).toBe(calls);
    expect((await c.get('/api/me/entitlements')).body.freeTrial.remaining).toBe(before);
  });

  it('G4 AI 실패 — 결과 없음·이용권 미소진, [다시 분석 요청]', async () => {
    const c = await as('general2');
    const before = (await c.get('/api/me/entitlements')).body.freeTrial.remaining;
    const r = await c.upload('/api/analysis-requests', [await photo('crack')], { description: '#fail' });
    const d = (await waitAnalysis(c, r.body.requestId)).body;
    expect(d.status).toBe('failed');
    expect(d.result).toBeNull();
    expect(d.gate.gate).toBe('G4');
    expect((await c.get('/api/me/entitlements')).body.freeTrial.remaining).toBe(before);
  });

  it('사진 0장은 422', async () => {
    const c = await as('general2');
    const r = await c.upload('/api/analysis-requests', [], { description: 'x' });
    expect(r.status).toBe(422);
  });

  it('잔여 1회에 동시 요청 2건 → 1건만 분석, 1건 G2 (R6)', async () => {
    const c = await as('general2');
    // 남은 체험을 1회로 맞춘다: 체험 이용권 quota 를 used+1 로
    const e = await queryOne<{ entitlement_id: number; used_count: number }>(
      "SELECT entitlement_id, used_count FROM v_entitlement_balance WHERE user_id = ? AND ent_kind = 'free_trial'",
      [fx.users.general2],
    );
    await exec('UPDATE entitlement SET quota_total = ? WHERE entitlement_id = ?', [Number(e!.used_count) + 1, e!.entitlement_id]);
    const p = await photo('crack');
    const [a, b] = await Promise.all([
      c.upload('/api/analysis-requests', [p], { description: '#normal' }),
      c.upload('/api/analysis-requests', [p], { description: '#normal' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 402]);
    const blocked = a.status === 402 ? a : b;
    expect(blocked.body.gate).toBe('G2');
  });

  it('일반 사용자 결과·권고에는 전문가 요청 권한이 없다 (FR-121)', async () => {
    const c = await as('general');
    expect((await c.get('/api/auth/me')).body.permissions).not.toContain('expert_request.create');
  });

  it('비회원: 로그인 없이 분석, 기기 단위 체험 한도 후 G2 + [로그인하고 이용권 구매]', async () => {
    const g = await new Client(await getApp()).init();
    const p = await photo('crack');
    for (let i = 0; i < 3; i++) {
      const r = await g.upload('/api/analysis-requests', [p], { description: '#normal' });
      expect(r.status).toBe(201);
      await waitAnalysis(g, r.body.requestId);
    }
    const uid = await g.deviceUserId();
    if (uid) guests.push(uid);
    const r = await g.upload('/api/analysis-requests', [p], { description: '#normal' });
    expect(r.status).toBe(402);
    expect(r.body.gate).toBe('G2');
    expect(r.body.actions[0].id).toBe('login-purchase');
    // 구매는 로그인 필요(401 G0)
    expect((await g.post('/api/payments', { planCode: 'per_analysis' })).status).toBe(401);
  });
});

describe('US2 이용권 구매', () => {
  it('승인 전 이용권 없음 → 승인 후 1건, 같은 결제 재확인해도 1건 (SC-006)', async () => {
    const c = await as('general2');
    const p = await c.post('/api/payments', { planCode: 'per_analysis' }, { 'Idempotency-Key': `k-${Date.now()}` });
    expect(p.status).toBe(201);
    expect(p.body.amount).toBeGreaterThan(0);
    const none = await queryOne('SELECT COUNT(*) AS n FROM entitlement WHERE payment_id = ?', [p.body.paymentId]);
    expect(Number(none!.n)).toBe(0);
    const ok = await c.post(`/api/payments/${p.body.paymentId}/confirm`, { cardNumber: '4111-1111-1111-1111' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');
    await c.post(`/api/payments/${p.body.paymentId}/confirm`, { cardNumber: '4111-1111-1111-1111' });
    const n = await queryOne('SELECT COUNT(*) AS n FROM entitlement WHERE payment_id = ?', [p.body.paymentId]);
    expect(Number(n!.n)).toBe(1);
  });

  it('거절 → G1 + 사유, 이용권 없음', async () => {
    const c = await as('general2');
    const p = await c.post('/api/payments', { planCode: 'monthly' });
    const r = await c.post(`/api/payments/${p.body.paymentId}/confirm`, { cardNumber: '4000-0000-0000-0002' });
    expect(r.status).toBe(402);
    expect(r.body.gate.gate).toBe('G1');
    expect(r.body.declineReason).toContain('한도');
    const n = await queryOne('SELECT COUNT(*) AS n FROM entitlement WHERE payment_id = ?', [p.body.paymentId]);
    expect(Number(n!.n)).toBe(0);
  });

  it('만료된 월 구독만 있으면 G2', async () => {
    const c = await as('general2');
    await exec(
      "UPDATE entitlement SET valid_until = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY), valid_from = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 40 DAY) WHERE user_id = ? AND ent_kind IN ('monthly')",
      [fx.users.general2],
    );
    await exec("UPDATE entitlement SET quota_total = 0 WHERE user_id = ? AND ent_kind IN ('free_trial')", [fx.users.general2]);
    // 건별 이용권 소진 처리: 남은 건별 이용권을 0으로
    await exec("UPDATE entitlement SET quota_total = 0 WHERE user_id = ? AND ent_kind = 'per_analysis'", [fx.users.general2]);
    const r = await c.upload('/api/analysis-requests', [await photo('crack')]);
    expect(r.status).toBe(402);
    expect(r.body.gate).toBe('G2');
  });

  it('비회원 결과 계정 연결 — 체험 합산(재가입으로 증가 없음)', async () => {
    const app = await getApp();
    const g = await new Client(app).init();
    const r = await g.upload('/api/analysis-requests', [await photo('leak')], { description: '#normal' });
    await waitAnalysis(g, r.body.requestId);
    const gid = await g.deviceUserId();
    if (gid) guests.push(gid);
    // 같은 브라우저(쿠키)로 로그인
    const login = await g.post('/api/auth/login', { email: (await import('./helpers')).email('enterprise'), password: 'TestPassw0rd!' });
    expect(login.body.guestLinkable).toBe(true);
    const before = await query("SELECT COUNT(*) AS n FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial'", [
      fx.users.enterprise,
    ]);
    const link = await g.post('/api/auth/link-guest');
    expect(link.status).toBe(200);
    expect(link.body.linkedCaseCount).toBe(1);
    const ent = (await g.get('/api/me/entitlements')).body;
    expect(ent.freeTrial.used).toBeGreaterThanOrEqual(1);
    const after = await query("SELECT COUNT(*) AS n FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial'", [fx.users.enterprise]);
    expect(Number(after[0].n)).toBeLessThanOrEqual(Math.max(1, Number(before[0].n)));
  });
});
