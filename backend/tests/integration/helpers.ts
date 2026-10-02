/**
 * 통합 테스트 도구 (research R20 모드 2 — 같은 DB + 표식 데이터).
 * 표식: 계정 *@test.buildcare.local · 건물/조직 이름 'TEST-' 접두어. 각 파일 끝에 표식 기준으로 지운다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { exec, query, queryOne, closePool } from '../../src/db/pool';
import { hashPassword } from '../../src/auth/password';
import { loadGateDefs } from '../../src/gates/gateBlock';
import { invalidateAll } from '../../src/auth/rbacService';
import { hashDeviceToken } from '../../src/auth/tokens';
import { makePhoto } from '../../src/db/seeds/lib/photoFactory';

export const PASSWORD = 'TestPassw0rd!';
export const RUN = crypto.randomBytes(3).toString('hex');
let app: Express | null = null;

export async function getApp(): Promise<Express> {
  if (!app) {
    await loadGateDefs(true);
    invalidateAll();
    app = createApp();
  }
  return app;
}

export const email = (name: string) => `${name}.${RUN}@test.buildcare.local`;

export interface Fixture {
  orgId: number;
  otherOrgId: number;
  buildings: Record<'A' | 'B' | 'X', number>;
  users: Record<string, number>;
}

export async function seedFixture(): Promise<Fixture> {
  // 기준값(시연 값과 같게) — 개발 DB 에 이미 있으면 그대로
  await exec("UPDATE service_constant SET const_value = COALESCE(const_value, '3') WHERE const_key = 'free_trial_count'");
  await exec("UPDATE service_constant SET const_value = COALESCE(const_value, '2') WHERE const_key = 'pattern_min_records'");
  await exec("UPDATE service_constant SET const_value = COALESCE(const_value, '7') WHERE const_key = 'due_soon_days'");
  await exec("UPDATE service_plan SET price_amount = COALESCE(price_amount, 3000) WHERE plan_code = 'per_analysis'");
  await exec("UPDATE service_plan SET price_amount = COALESCE(price_amount, 29000) WHERE plan_code = 'monthly'");
  await exec(
    "INSERT INTO building_type_code (building_type_code, building_type_name) SELECT 'office', '사무시설' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM building_type_code WHERE building_type_code = 'office')",
  );

  const org = await exec('INSERT INTO organization (org_name, license_expires_on) VALUES (?, DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY))', [
    `TEST-org-${RUN}`,
  ]);
  const other = await exec('INSERT INTO organization (org_name, license_expires_on) VALUES (?, DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY))', [
    `TEST-other-${RUN}`,
  ]);
  const mkB = async (name: string, orgId: number, bms: string | null) =>
    (
      await exec("INSERT INTO building (org_id, building_name, building_type_code, bms_ref) VALUES (?, ?, 'office', ?)", [
        orgId,
        `TEST-${name}-${RUN}`,
        bms,
      ])
    ).insertId;
  const buildings = {
    A: await mkB('A', org.insertId, 'HB-A'),
    B: await mkB('B', org.insertId, 'FAIL-T'),
    X: await mkB('X', other.insertId, null),
  };
  const hash = await hashPassword(PASSWORD);
  const users: Record<string, number> = {};
  const mkU = async (key: string, roles: string[], orgId: number | null, operator = false) => {
    const u = await exec('INSERT INTO user_account (email, display_name, phone, org_id) VALUES (?, ?, ?, ?)', [
      email(key),
      `테스트${key}`,
      '010-0000-1111',
      orgId,
    ]);
    await exec('INSERT INTO user_credential (user_id, password_hash) VALUES (?, ?)', [u.insertId, hash]);
    for (const r of roles) await exec('INSERT INTO user_role (user_id, role_code) VALUES (?, ?)', [u.insertId, r]);
    if (operator) await exec("INSERT INTO user_system_role (user_id, role_code) VALUES (?, 'operator')", [u.insertId]);
    users[key] = u.insertId;
  };
  await mkU('general', ['general'], null);
  await mkU('general2', ['general'], null);
  await mkU('facility', ['facility'], org.insertId);
  await mkU('building', ['building'], org.insertId);
  await mkU('enterprise', ['enterprise'], org.insertId);
  await mkU('enterpriseX', ['enterprise'], other.insertId);
  await mkU('expert', ['expert'], null);
  await mkU('operator', [], null, true);
  await exec(
    "INSERT INTO building_access (user_id, building_id, access_kind) VALUES (?, ?, 'record'), (?, ?, 'record'), (?, ?, 'manage'), (?, ?, 'manage')",
    [users.facility, buildings.A, users.facility, buildings.B, users.building, buildings.A, users.building, buildings.B],
  );
  await exec("INSERT INTO expert_specialty (expert_id, specialty_code) VALUES (?, 'structure'), (?, 'waterproof')", [
    users.expert,
    users.expert,
  ]);
  for (let d = 0; d < 10; d++)
    await exec('INSERT INTO expert_availability (expert_id, available_on) VALUES (?, DATE_ADD(CURRENT_DATE, INTERVAL ? DAY))', [
      users.expert,
      d,
    ]);
  return { orgId: org.insertId, otherOrgId: other.insertId, buildings, users };
}

/** 표식 데이터 정리 — FK 역순. 테스트 중 만든 비회원 계정은 guestIds 로 넘긴다 */
export async function cleanup(extraUserIds: number[] = [], all = false) {
  const emailPat = all ? '%@test.buildcare.local' : `%.${RUN}@test.buildcare.local`;
  const namePat = all ? 'TEST-%' : `TEST-%-${RUN}`;
  const users = (await query<{ user_id: number }>('SELECT user_id FROM user_account WHERE email LIKE ?', [emailPat])).map((r) => r.user_id);
  const allUsers = [...users, ...extraUserIds];
  const blds = (await query<{ building_id: number }>('SELECT building_id FROM building WHERE building_name LIKE ?', [namePat])).map(
    (r) => r.building_id,
  );
  const orgs = (await query<{ org_id: number }>('SELECT org_id FROM organization WHERE org_name LIKE ?', [namePat])).map((r) => r.org_id);
  const U = allUsers.length ? allUsers : [-1];
  const B = blds.length ? blds : [-1];
  const O = orgs.length ? orgs : [-1];
  const cases = (
    await query<{ case_id: number }>('SELECT case_id FROM defect_case WHERE owner_id IN (?) OR building_id IN (?)', [U, B])
  ).map((r) => r.case_id);
  const C = cases.length ? cases : [-1];
  const del = (sql: string, p: unknown[]) => exec(sql, p);
  await del(
    'DELETE ec FROM expert_connection ec JOIN expert_request_attempt t ON t.attempt_id = ec.attempt_id JOIN expert_request er ON er.exp_req_id = t.exp_req_id WHERE er.case_id IN (?)',
    [C],
  );
  await del('DELETE t FROM expert_request_attempt t JOIN expert_request er ON er.exp_req_id = t.exp_req_id WHERE er.case_id IN (?)', [C]);
  await del('DELETE s FROM share_consent s JOIN expert_request er ON er.exp_req_id = s.exp_req_id WHERE er.case_id IN (?)', [C]);
  await del('DELETE FROM expert_request WHERE case_id IN (?)', [C]);
  await del('DELETE FROM risk_notice WHERE case_id IN (?)', [C]);
  const runs = (await query<{ run_id: number }>('SELECT run_id FROM priority_run WHERE org_id IN (?)', [O])).map((r) => r.run_id);
  const R = runs.length ? runs : [-1];
  await del('DELETE FROM priority_item_basis WHERE run_id IN (?)', [R]);
  await del('DELETE FROM priority_item WHERE run_id IN (?)', [R]);
  await del('DELETE FROM priority_run WHERE run_id IN (?)', [R]);
  await del(
    'DELETE FROM gate_event WHERE actor_id IN (?) OR released_by IN (?) OR (subject_kind = ? AND subject_id IN (?)) OR (subject_kind = ? AND subject_id IN (?))',
    [U, U, 'building', B, 'organization', O],
  );
  await del('DELETE a FROM schedule_alert a JOIN inspection_schedule s ON s.schedule_id = a.schedule_id WHERE s.building_id IN (?)', [B]);
  await del('DELETE FROM inspection_schedule WHERE building_id IN (?)', [B]);
  await del(
    'DELETE d FROM data_request d JOIN verification_item i ON i.item_id = d.item_id JOIN inspection_record r ON r.record_id = i.record_id WHERE r.case_id IN (?)',
    [C],
  );
  await del(
    'DELETE v FROM expert_verdict v JOIN verification_item i ON i.item_id = v.item_id JOIN inspection_record r ON r.record_id = i.record_id WHERE r.case_id IN (?)',
    [C],
  );
  await del('DELETE i FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id WHERE r.case_id IN (?)', [C]);
  await del('DELETE l FROM record_repair_log l JOIN inspection_record r ON r.record_id = l.record_id WHERE r.case_id IN (?)', [C]);
  await del('DELETE k FROM inspection_record_risk k JOIN inspection_record r ON r.record_id = k.record_id WHERE r.case_id IN (?)', [C]);
  await del('DELETE p FROM record_photo p JOIN inspection_record r ON r.record_id = p.record_id WHERE r.case_id IN (?)', [C]);
  await del('DELETE FROM inspection_record WHERE case_id IN (?)', [C]);
  await del(
    'DELETE a FROM analysis_action a JOIN analysis_result ar ON ar.result_id = a.result_id JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id IN (?)',
    [C],
  );
  await del(
    'DELETE a FROM analysis_cause a JOIN analysis_result ar ON ar.result_id = a.result_id JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id IN (?)',
    [C],
  );
  await del('DELETE ar FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id IN (?)', [C]);
  await del('DELETE p FROM analysis_photo p JOIN analysis_request q ON q.request_id = p.request_id WHERE q.case_id IN (?)', [C]);
  await del('DELETE FROM analysis_request WHERE case_id IN (?) OR requester_id IN (?)', [C, U]);
  await del('DELETE FROM defect_case WHERE case_id IN (?)', [C]);
  await del('DELETE FROM entitlement WHERE user_id IN (?)', [U]);
  await del('DELETE FROM payment WHERE user_id IN (?)', [U]);
  await del('DELETE x FROM external_history x WHERE x.building_id IN (?)', [B]);
  await del('DELETE FROM bms_sync_run WHERE building_id IN (?)', [B]);
  await del('DELETE FROM expert_availability WHERE expert_id IN (?)', [U]);
  await del('DELETE FROM expert_specialty WHERE expert_id IN (?)', [U]);
  await del('DELETE FROM notification WHERE recipient_id IN (?)', [U]);
  await del('DELETE FROM permission_request WHERE requester_id IN (?) OR building_id IN (?) OR org_id IN (?)', [U, B, O]);
  await del('DELETE FROM rbac_audit_log WHERE actor_id IN (?) OR target_user_id IN (?)', [U, U]);
  await del('DELETE FROM auth_login_attempt WHERE email LIKE ?', [emailPat]);
  await del('DELETE FROM guest_device WHERE guest_user_id IN (?) OR linked_user_id IN (?)', [U, U]);
  await del('DELETE FROM building_access WHERE user_id IN (?) OR building_id IN (?)', [U, B]);
  await del('DELETE FROM user_system_role WHERE user_id IN (?)', [U]);
  await del('DELETE FROM user_credential WHERE user_id IN (?)', [U]);
  await del('DELETE FROM user_role WHERE user_id IN (?)', [U]);
  await del('UPDATE user_account SET org_id = NULL WHERE user_id IN (?)', [U]);
  await del('DELETE FROM user_account WHERE user_id IN (?)', [U]);
  await del('DELETE FROM building WHERE building_id IN (?)', [B]);
  await del('DELETE FROM organization WHERE org_id IN (?)', [O]);
}

export async function done(extra: number[] = []) {
  // 비동기 AI 처리가 남아 있으면 끝날 때까지 잠시 대기
  await new Promise((r) => setTimeout(r, 1500));
  await cleanup(extra);
  await closePool();
}

/** 로그인된 supertest 에이전트 + CSRF */
export class Client {
  agent: request.Agent;
  csrf = '';
  constructor(app: Express) {
    this.agent = request.agent(app);
  }
  async init() {
    const r = await this.agent.get('/api/auth/csrf');
    this.csrf = r.body.token;
    return this;
  }
  async login(key: string, password = PASSWORD) {
    await this.init();
    return this.agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', this.csrf)
      .send({ email: email(key), password });
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body: any = {}, headers: Record<string, string> = {}) {
    return this.agent.post(url).set('X-CSRF-Token', this.csrf).set(headers).send(body);
  }
  patch(url: string, body: any) {
    return this.agent.patch(url).set('X-CSRF-Token', this.csrf).send(body);
  }
  put(url: string, body: any) {
    return this.agent.put(url).set('X-CSRF-Token', this.csrf).send(body);
  }
  upload(url: string, files: Buffer[], fields: Record<string, string> = {}, field = 'photos') {
    let r = this.agent.post(url).set('X-CSRF-Token', this.csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    files.forEach((f, i) => (r = r.attach(field, f, { filename: `p${i}.jpg`, contentType: 'image/jpeg' })));
    return r;
  }
  deviceUserId = async (): Promise<number | null> => {
    const c = (this.agent as any).jar?.getCookie?.('bc_device', { path: '/', domain: '127.0.0.1', secure: false, script: false });
    const token = c?.value;
    if (!token) return null;
    const d = await queryOne<{ guest_user_id: number }>('SELECT guest_user_id FROM guest_device WHERE token_hash = ?', [
      hashDeviceToken(token),
    ]);
    return d?.guest_user_id ?? null;
  };
}

export async function as(key: string): Promise<Client> {
  const c = new Client(await getApp());
  const r = await c.login(key);
  if (r.status !== 200) throw new Error(`login ${key} failed ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

const photoCache = new Map<string, Buffer>();
export async function photo(kind: 'crack' | 'leak' | 'condensation' = 'crack', q: 'good' | 'dark' | 'blurry' | 'small' = 'good') {
  const k = `${kind}-${q}`;
  if (!photoCache.has(k)) {
    const f = path.resolve(__dirname, '../fixtures/photos', `${kind}-${q}.jpg`);
    photoCache.set(k, fs.existsSync(f) ? fs.readFileSync(f) : await makePhoto(kind, q, 11));
  }
  return photoCache.get(k)!;
}

/** 분석 완료까지 폴링 */
export async function waitAnalysis(c: Client, requestId: number, ms = 15_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await c.get(`/api/analysis-requests/${requestId}`);
    if (r.body.status !== 'analyzing' || Date.now() > until) return r;
    await new Promise((res) => setTimeout(res, 400));
  }
}

/** 시설관리자 결과 하나(건물 A) 만들기 — 월 구독 부여 후 분석 */
export async function giveMonthly(userId: number) {
  const p = await exec("INSERT INTO payment (user_id, plan_code, amount) VALUES (?, 'monthly', 29000)", [userId]);
  await exec("UPDATE payment SET pay_status = 'approved', decided_at = CURRENT_TIMESTAMP WHERE payment_id = ?", [p.insertId]);
  await exec(
    "INSERT INTO entitlement (user_id, ent_kind, payment_id, valid_until) VALUES (?, 'monthly', ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 MONTH))",
    [userId, p.insertId],
  );
}
