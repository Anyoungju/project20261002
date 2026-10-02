import crypto from 'node:crypto';
import { env, isProd } from '../../../config/env';
import { exec, query, queryOne, Db, getPool } from '../../pool';
import { hashPassword } from '../../../auth/password';
import { storeSeedPhoto, PhotoKind } from './photoFactory';
import { nextCaseNo } from '../../../modules/case/caseService';

/** research R23 — 시드 공통 도구: 가드 · 상대 날짜 · 비밀번호 · ID 레지스트리 · 상태 전이 순서 헬퍼 */
export class SeedContext {
  users = new Map<string, number>();
  buildings = new Map<string, number>();
  orgs = new Map<string, number>();
  password: string;
  passwordGenerated: boolean;
  db: Db = getPool();
  log: string[] = [];

  constructor() {
    if (isProd) throw new Error('운영 환경(NODE_ENV=production)에서는 시드를 실행하지 않습니다');
    if (env.SEED_DEMO_PASSWORD) {
      this.password = env.SEED_DEMO_PASSWORD;
      this.passwordGenerated = false;
    } else {
      this.password = `Demo${crypto.randomBytes(5).toString('hex')}9`;
      this.passwordGenerated = true;
    }
  }

  u(email: string): number {
    const id = this.users.get(email);
    if (!id) throw new Error(`시드 사용자 없음: ${email}`);
    return id;
  }

  b(key: string): number {
    const id = this.buildings.get(key);
    if (!id) throw new Error(`시드 건물 없음: ${key}`);
    return id;
  }

  async loadRegistry() {
    for (const r of await query<{ user_id: number; email: string }>(
      "SELECT user_id, email FROM user_account WHERE email LIKE '%@dev.local'",
    )) {
      this.users.set(r.email, r.user_id);
    }
    for (const r of await query<{ building_id: number; bms_ref: string | null; building_name: string }>(
      'SELECT building_id, bms_ref, building_name FROM building',
    )) {
      const key = BUILDING_KEYS[r.building_name];
      if (key) this.buildings.set(key, r.building_id);
    }
    for (const r of await query<{ org_id: number; org_name: string }>('SELECT org_id, org_name FROM organization')) {
      const key = ORG_KEYS[r.org_name];
      if (key) this.orgs.set(key, r.org_id);
    }
  }

  async createUser(
    email: string,
    name: string,
    phone: string | null,
    orgKey: string | null,
    roles: string[],
    opts: { operator?: boolean; disabled?: boolean } = {},
  ) {
    const orgId = orgKey ? this.orgs.get(orgKey)! : null;
    const r = await exec('INSERT INTO user_account (email, display_name, phone, org_id) VALUES (?, ?, ?, ?)', [email, name, phone, orgId]);
    await exec('INSERT INTO user_credential (user_id, password_hash, disabled_at) VALUES (?, ?, ?)', [
      r.insertId,
      await hashPassword(this.password),
      opts.disabled ? new Date(Date.now() - 86400_000) : null,
    ]);
    for (const role of roles) await exec('INSERT INTO user_role (user_id, role_code) VALUES (?, ?)', [r.insertId, role]);
    if (opts.operator) await exec("INSERT INTO user_system_role (user_id, role_code) VALUES (?, 'operator')", [r.insertId]);
    this.users.set(email, r.insertId);
    return r.insertId;
  }
}

export const BUILDING_KEYS: Record<string, string> = {
  '한빛오피스타워 A동': 'BLD-A',
  '한빛아파트 101동': 'BLD-B',
  한빛물류센터: 'BLD-C',
  새솔빌딩: 'BLD-D',
};
export const ORG_KEYS: Record<string, string> = { 한빛FM: 'ORG-HB', 새솔관리: 'ORG-SS' };

/** 실행일 기준 상대 날짜 */
export function daysFromToday(n: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86400_000); // KST
  return d.toISOString().slice(0, 10);
}
export function tsDaysAgo(n: number, hour = 10): string {
  return `${daysFromToday(-n)} ${String(hour).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}:00`;
}

// ---------------------------------------------------------------- 상태 전이 순서 헬퍼

export async function ensureMonthly(userId: number) {
  const has = await queryOne(
    "SELECT 1 AS x FROM entitlement WHERE user_id = ? AND ent_kind = 'monthly' AND valid_until > CURRENT_TIMESTAMP",
    [userId],
  );
  if (has) return;
  const p = await exec("INSERT INTO payment (user_id, plan_code, amount) VALUES (?, 'monthly', 29000)", [userId]);
  await exec("UPDATE payment SET pay_status = 'approved', decided_at = CURRENT_TIMESTAMP, pg_tx_ref = ? WHERE payment_id = ?", [
    `seed_${p.insertId}`,
    p.insertId,
  ]);
  await exec(
    "INSERT INTO entitlement (user_id, ent_kind, payment_id, valid_until) VALUES (?, 'monthly', ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 MONTH))",
    [userId, p.insertId],
  );
}

export async function ensureTrial(userId: number, quota = 3) {
  const t = await queryOne<{ entitlement_id: number }>(
    "SELECT entitlement_id FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial'",
    [userId],
  );
  if (t) return t.entitlement_id;
  return (await exec("INSERT INTO entitlement (user_id, ent_kind, quota_total) VALUES (?, 'free_trial', ?)", [userId, quota])).insertId;
}

export async function newCase(ownerId: number, buildingId: number | null, createdDaysAgo = 0) {
  const caseNo = await nextCaseNo(getPool());
  const r = await exec('INSERT INTO defect_case (case_no, owner_id, building_id, created_at) VALUES (?, ?, ?, ?)', [
    caseNo,
    ownerId,
    buildingId,
    tsDaysAgo(createdDaysAgo, 9),
  ]);
  return { caseId: r.insertId, caseNo };
}

const MOCK_RESULTS: Record<string, { risk: 'normal' | 'caution' | 'danger'; conf: number; causes: string[]; actions: string[] }> = {
  crack: {
    risk: 'normal',
    conf: 0.86,
    causes: ['콘크리트 건조 수축에 의한 표면 미세 균열', '온도 변화에 따른 마감재 신축'],
    actions: ['균열 폭을 30일 간격으로 재촬영해 진행 여부를 확인합니다', '진행이 없으면 표면 보수재로 마감합니다'],
  },
  crack_danger: {
    risk: 'danger',
    conf: 0.78,
    causes: ['구조체 균열 진행 가능성(폭 0.3mm 이상 추정)', '하중 변화 또는 부동 침하'],
    actions: ['균열 게이지를 설치하고 진행 여부를 매주 확인합니다', '자격 있는 구조 전문가의 점검을 받으세요'],
  },
  condensation: {
    risk: 'caution',
    conf: 0.55,
    causes: ['실내외 온도차로 인한 표면 결로', '환기 부족으로 인한 습기 정체', '단열재 시공 불량 가능성'],
    actions: ['하루 2회 이상 환기하고 제습기를 사용합니다', '결로가 반복되면 단열 상태 점검을 받으세요'],
  },
  leak: {
    risk: 'danger',
    conf: 0.81,
    causes: ['상부 슬래브 방수층 손상으로 인한 누수', '배관 접합부 파손', '구조체 균열을 통한 우수 유입'],
    actions: ['누수 부위 아래 전기 설비 사용을 중지하고 차단합니다', '자격 있는 전문가의 방수·구조 점검을 받으세요'],
  },
  leak_caution: {
    risk: 'caution',
    conf: 0.72,
    causes: ['배수 드레인 막힘으로 인한 국부 누수', '방수층 노후'],
    actions: ['드레인을 청소하고 우천 후 재확인합니다', '반복되면 방수층 보수를 계획합니다'],
  },
};

/**
 * 분석 1건을 트리거 순서대로: received → 사진 → analyzing(이용권) → 결과 INSERT(트리거가 completed·위험 통지)
 * kind 의 mock 결과를 쓴다.
 */
export async function seedAnalysis(opts: {
  ownerId: number;
  buildingId: number | null;
  photo: PhotoKind;
  result: keyof typeof MOCK_RESULTS;
  daysAgo: number;
  description: string;
  caseId?: number;
  photoSeed?: number;
}) {
  const c = opts.caseId ? { caseId: opts.caseId } : await newCase(opts.ownerId, opts.buildingId, opts.daysAgo);
  const ent = await queryOne<{ entitlement_id: number }>(
    `SELECT b.entitlement_id FROM v_entitlement_balance b JOIN entitlement e ON e.entitlement_id = b.entitlement_id
      WHERE b.user_id = ? AND b.is_usable = 1 ORDER BY FIELD(b.ent_kind,'free_trial','per_analysis','monthly') LIMIT 1`,
    [opts.ownerId],
  );
  if (!ent) throw new Error(`시드: 사용자 ${opts.ownerId} 에게 사용 가능한 이용권이 없습니다`);
  const when = tsDaysAgo(opts.daysAgo, 10);
  const q = await exec('INSERT INTO analysis_request (case_id, requester_id, description, requested_at) VALUES (?, ?, ?, ?)', [
    c.caseId,
    opts.ownerId,
    opts.description,
    when,
  ]);
  const key = await storeSeedPhoto(opts.photo, opts.photoSeed ?? q.insertId);
  await exec('INSERT INTO analysis_photo (request_id, storage_key, taken_at, uploaded_at) VALUES (?, ?, ?, ?)', [
    q.insertId,
    key,
    when,
    when,
  ]);
  await exec("UPDATE analysis_request SET req_status = 'analyzing', entitlement_id = ? WHERE request_id = ?", [
    ent.entitlement_id,
    q.insertId,
  ]);
  const m = MOCK_RESULTS[opts.result];
  const notice = await queryOne<{ notice_id: number }>(
    "SELECT notice_id FROM notice_text WHERE notice_kind = 'analysis' ORDER BY effective_from DESC, notice_id DESC LIMIT 1",
  );
  const r = await exec(
    "INSERT INTO analysis_result (request_id, notice_id, notice_kind, risk_level, ai_confidence, completed_at) VALUES (?, ?, 'analysis', ?, ?, ?)",
    [q.insertId, notice!.notice_id, m.risk, m.conf, when],
  );
  for (const [i, t] of m.causes.entries())
    await exec('INSERT INTO analysis_cause (result_id, cause_rank, cause_text) VALUES (?, ?, ?)', [r.insertId, i + 1, t]);
  for (const [i, t] of m.actions.entries())
    await exec('INSERT INTO analysis_action (result_id, action_seq, action_text) VALUES (?, ?, ?)', [r.insertId, i + 1, t]);
  // 트리거가 만든 위험 통지의 시각도 과거로 맞춘다
  await exec('UPDATE risk_notice SET created_at = ? WHERE result_id = ?', [when, r.insertId]);
  return { caseId: c.caseId, requestId: q.insertId, resultId: r.insertId };
}

/** 현장 기록: draft INSERT → 필드 → 사진 → saved (트리거: 불일치면 verification_item) */
export async function seedRecord(opts: {
  caseId?: number;
  recorderId: number;
  buildingId: number;
  resultId?: number | null;
  location: string;
  defect: PhotoKind;
  repair: 'completed' | 'pending';
  aiMatch?: 'match' | 'mismatch' | 'none';
  note?: string;
  daysAgo: number;
  save?: boolean;
  risk?: boolean;
  photo?: boolean;
}) {
  const caseId = opts.caseId ?? (await newCase(opts.recorderId, opts.buildingId, opts.daysAgo)).caseId;
  const when = tsDaysAgo(opts.daysAgo, 14);
  const r = await exec('INSERT INTO inspection_record (case_id, building_id, recorder_id, result_id, created_at) VALUES (?, ?, ?, ?, ?)', [
    caseId,
    opts.buildingId,
    opts.recorderId,
    opts.resultId ?? null,
    when,
  ]);
  await exec(
    'UPDATE inspection_record SET location_text = ?, defect_type_code = ?, repair_status = ?, ai_match = ?, inspection_note = ?, repair_method = ? WHERE record_id = ?',
    [
      opts.location,
      opts.defect,
      opts.repair,
      opts.resultId ? (opts.aiMatch ?? 'match') : 'none',
      opts.note ?? null,
      opts.repair === 'completed' ? '보수재 충전 및 마감' : null,
      r.insertId,
    ],
  );
  if (opts.photo !== false) {
    const key = await storeSeedPhoto(opts.defect, 1000 + r.insertId);
    await exec('INSERT INTO record_photo (record_id, storage_key, uploaded_at) VALUES (?, ?, ?)', [r.insertId, key, when]);
  }
  if (opts.risk)
    await exec('INSERT INTO inspection_record_risk (record_id, risk_flag, flagged_at) VALUES (?, TRUE, ?)', [r.insertId, when]);
  if (opts.save !== false) {
    await exec("UPDATE inspection_record SET record_status = 'saved', saved_at = ? WHERE record_id = ?", [when, r.insertId]);
    await exec('UPDATE verification_item SET created_at = ? WHERE record_id = ?', [when, r.insertId]);
  }
  return { caseId, recordId: r.insertId };
}

export async function itemOf(recordId: number): Promise<number> {
  const i = await queryOne<{ item_id: number }>('SELECT item_id FROM verification_item WHERE record_id = ?', [recordId]);
  if (!i) throw new Error(`검증 대상 없음: record ${recordId}`);
  return i.item_id;
}

/** 판정: item_id 를 값으로 (1442 규약) */
export async function seedVerdict(
  itemId: number,
  expertId: number,
  v: { verdict: 'match' | 'mismatch'; opinion?: string; diff?: string; riskHigh?: boolean; daysAgo: number },
) {
  const when = tsDaysAgo(v.daysAgo, 16);
  const r = await exec(
    'INSERT INTO expert_verdict (item_id, version_no, expert_id, verdict, opinion, diff_note, risk_high, decided_at) VALUES (?, 0, ?, ?, ?, ?, ?, ?)',
    [itemId, expertId, v.verdict, v.opinion ?? null, v.diff ?? null, !!v.riskHigh, when],
  );
  await exec('UPDATE risk_notice SET created_at = ? WHERE verdict_id = ?', [when, r.insertId]);
  return r.insertId;
}

export async function seedNotify(recipientId: number, kind: string, title: string, link: string | null, daysAgo = 0) {
  await exec('INSERT INTO notification (recipient_id, kind, title, link, created_at) VALUES (?, ?, ?, ?, ?)', [
    recipientId,
    kind,
    title,
    link,
    tsDaysAgo(daysAgo, 11),
  ]);
}
