import { exec, query, queryOne } from '../pool';
import {
  SeedContext,
  daysFromToday,
  tsDaysAgo,
  ensureMonthly,
  ensureTrial,
  newCase,
  seedAnalysis,
  seedRecord,
  seedVerdict,
  itemOf,
  seedNotify,
} from './lib/seedContext';
import { storeSeedPhoto } from './lib/photoFactory';
import { syncBuilding } from '../../modules/building/buildingService';
import { createRun } from '../../modules/priority/priorityService';

/** tasks 부록 B — 스토리별 시드. 모든 쓰기는 트리거 순서를 따른다 */

// ------------------------------------------------------------------ US1
export async function seedUs1(ctx: SeedContext) {
  const g = ctx.u('general@dev.local');
  await ensureTrial(g, 3);
  await seedAnalysis({
    ownerId: g,
    buildingId: null,
    photo: 'crack',
    result: 'crack',
    daysAgo: 12,
    description: '거실 벽에 머리카락 같은 금이 생겼어요',
  });
  await seedAnalysis({
    ownerId: g,
    buildingId: null,
    photo: 'condensation',
    result: 'condensation',
    daysAgo: 5,
    description: '겨울마다 베란다 창 주변에 물방울과 곰팡이가 생깁니다',
  });
  // 품질 부적합(G3) — 이용권 미소진
  const c3 = await newCase(g, null, 3);
  const q3 = await exec(
    "INSERT INTO analysis_request (case_id, requester_id, description, req_status, quality_reject_reason, requested_at) VALUES (?, ?, ?, 'quality_rejected', ?, ?)",
    [c3.caseId, g, '천장 얼룩이 번지고 있어요', '사진이 너무 어둡습니다 - 밝은 곳에서 다시 찍어 주세요', tsDaysAgo(3)],
  );
  await exec('INSERT INTO analysis_photo (request_id, storage_key, uploaded_at) VALUES (?, ?, ?)', [
    q3.insertId,
    await storeSeedPhoto('leak', 31, 'dark'),
    tsDaysAgo(3),
  ]);
  await exec(
    "INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at) VALUES ('G3', ?, 'analysis_request', ?, ?, ?)",
    [g, q3.insertId, '사진이 너무 어둡습니다', tsDaysAgo(3)],
  );
  // AI 실패(G4) — analyzing 이후 failed, 이용권 미소진(뷰가 failed 를 세지 않음)
  const c4 = await newCase(g, null, 2);
  const trial = await queryOne<{ entitlement_id: number }>(
    "SELECT entitlement_id FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial'",
    [g],
  );
  const q4 = await exec('INSERT INTO analysis_request (case_id, requester_id, description, requested_at) VALUES (?, ?, ?, ?)', [
    c4.caseId,
    g,
    '현관 바닥 타일이 들떴어요',
    tsDaysAgo(2),
  ]);
  await exec('INSERT INTO analysis_photo (request_id, storage_key, uploaded_at) VALUES (?, ?, ?)', [
    q4.insertId,
    await storeSeedPhoto('crack', 41),
    tsDaysAgo(2),
  ]);
  await exec("UPDATE analysis_request SET req_status = 'analyzing', entitlement_id = ? WHERE request_id = ?", [
    trial!.entitlement_id,
    q4.insertId,
  ]);
  await exec("UPDATE analysis_request SET req_status = 'failed' WHERE request_id = ?", [q4.insertId]);
  await exec(
    "INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at) VALUES ('G4', ?, 'analysis_request', ?, ?, ?)",
    [g, q4.insertId, 'AI 분석 서비스가 응답하지 않았습니다', tsDaysAgo(2)],
  );

  // 건물 건: 시설관리자가 BLD-A 에서 분석 → danger → 위험 통지(analysis) — 건물관리자 전문가 연결 시연용
  const f = ctx.u('facility@dev.local');
  await ensureMonthly(f);
  const d = await seedAnalysis({
    ownerId: f,
    buildingId: ctx.b('BLD-A'),
    photo: 'leak',
    result: 'leak',
    daysAgo: 1,
    description: 'B2 주차장 천장에서 물이 떨어집니다. 바닥에 물이 고였어요',
  });
  await seedNotify(
    ctx.u('building@dev.local'),
    'risk_notice',
    '위험 통지: 한빛오피스타워 A동 B2 주차장 천장 누수 - 전문가 점검 권고',
    `/expert-requests/new?caseId=${d.caseId}`,
    1,
  );
  ctx.log.push('US1: general@ 결과 2건(정상·주의) + G3 1건 + G4 1건, 무료 체험 1회 남음 · BLD-A 위험 통지 1건');
  return { b2CaseId: d.caseId, b2ResultId: d.resultId };
}

// ------------------------------------------------------------------ US2
export async function seedUs2(ctx: SeedContext) {
  const e = ctx.u('general.empty@dev.local');
  await ensureTrial(e, 3);
  await seedAnalysis({ ownerId: e, buildingId: null, photo: 'crack', result: 'crack', daysAgo: 20, description: '욕실 타일 줄눈 균열' });
  await seedAnalysis({
    ownerId: e,
    buildingId: null,
    photo: 'leak',
    result: 'leak_caution',
    daysAgo: 14,
    description: '싱크대 하부 물자국',
  });
  await seedAnalysis({
    ownerId: e,
    buildingId: null,
    photo: 'condensation',
    result: 'condensation',
    daysAgo: 7,
    description: '북쪽 방 벽지 곰팡이',
  });
  // 거절 결제 이력(G1)
  const p = await exec("INSERT INTO payment (user_id, plan_code, amount, requested_at) VALUES (?, 'per_analysis', 3000, ?)", [
    e,
    tsDaysAgo(1),
  ]);
  await exec(
    "UPDATE payment SET pay_status = 'declined', decline_reason = '카드 한도가 초과되었습니다', decided_at = ?, pg_tx_ref = ? WHERE payment_id = ?",
    [tsDaysAgo(1), `seed_${p.insertId}`, p.insertId],
  );
  await exec(
    "INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at) VALUES ('G1', ?, 'payment', ?, '카드 한도가 초과되었습니다', ?)",
    [e, p.insertId, tsDaysAgo(1)],
  );

  const x = ctx.u('general.expired@dev.local');
  await ensureTrial(x, 3);
  for (const [i, k] of (['crack', 'leak_caution', 'condensation'] as const).entries()) {
    await seedAnalysis({
      ownerId: x,
      buildingId: null,
      photo: k === 'leak_caution' ? 'leak' : (k as any),
      result: k,
      daysAgo: 60 - i * 5,
      description: '주택 하자 사진',
    });
  }
  const pm = await exec("INSERT INTO payment (user_id, plan_code, amount, requested_at) VALUES (?, 'monthly', 29000, ?)", [
    x,
    tsDaysAgo(40),
  ]);
  await exec("UPDATE payment SET pay_status = 'approved', decided_at = ?, pg_tx_ref = ? WHERE payment_id = ?", [
    tsDaysAgo(40),
    `seed_${pm.insertId}`,
    pm.insertId,
  ]);
  await exec("INSERT INTO entitlement (user_id, ent_kind, payment_id, valid_from, valid_until) VALUES (?, 'monthly', ?, ?, ?)", [
    x,
    pm.insertId,
    tsDaysAgo(40),
    `${daysFromToday(-1)} 23:59:59`,
  ]);
  ctx.log.push('US2: general.empty@ 체험 소진·거절 결제 1건 · general.expired@ 만료 월 구독');
}

// ------------------------------------------------------------------ RBAC
export async function seedRbac(ctx: SeedContext) {
  const hb = ctx.orgs.get('ORG-HB')!;
  const p1 = await exec(
    "INSERT INTO permission_request (requester_id, building_id, org_id, requested_screen, requested_at) VALUES (?, ?, ?, 'S3', ?)",
    [ctx.u('facility.c@dev.local'), ctx.b('BLD-A'), hb, tsDaysAgo(1)],
  );
  const p2 = await exec(
    "INSERT INTO permission_request (requester_id, building_id, org_id, requested_screen, requested_at) VALUES (?, ?, ?, 'S5', ?)",
    [ctx.u('lead@dev.local'), ctx.b('BLD-B'), hb, tsDaysAgo(0)],
  );
  await exec(
    "INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at) VALUES ('G0', ?, 'building', ?, '이 건물에 대한 권한이 없습니다', ?)",
    [ctx.u('facility.c@dev.local'), ctx.b('BLD-A'), tsDaysAgo(1)],
  );
  for (const r of [ctx.u('enterprise@dev.local'), ctx.u('operator@dev.local')]) {
    await seedNotify(r, 'permission_request', '새 권한 요청이 도착했습니다', '/admin/permission-requests', 1);
  }
  const op = ctx.u('operator@dev.local');
  await exec('INSERT INTO rbac_audit_log (actor_id, action, target_user_id, detail_json, at) VALUES (?, ?, ?, ?, ?)', [
    op,
    'user.roles',
    ctx.u('lead@dev.local'),
    JSON.stringify({ roles: ['building', 'facility'] }),
    tsDaysAgo(9),
  ]);
  await exec('INSERT INTO rbac_audit_log (actor_id, action, target_user_id, detail_json, at) VALUES (?, ?, ?, ?, ?)', [
    op,
    'access.grant',
    ctx.u('facility@dev.local'),
    JSON.stringify({ buildingId: ctx.b('BLD-A'), kind: 'record' }),
    tsDaysAgo(9),
  ]);
  await exec('INSERT INTO rbac_audit_log (actor_id, action, target_user_id, detail_json, at) VALUES (?, ?, ?, ?, ?)', [
    op,
    'user.disable',
    ctx.u('disabled@dev.local'),
    '{}',
    tsDaysAgo(1),
  ]);
  ctx.log.push(`RBAC: 대기 권한 요청 ${[p1.insertId, p2.insertId].length}건 · 비활성 계정 1 · 다중 역할 lead@ · 감사 로그 3건`);
}

// ------------------------------------------------------------------ US3
export async function seedUs3(ctx: SeedContext, b2: { b2CaseId: number; b2ResultId: number } | null) {
  const f = ctx.u('facility@dev.local');
  const A = ctx.b('BLD-A');
  await ensureMonthly(f);
  // 반복 하자 묶음: B2 주차장 천장 누수 (내부 3 + 외부 2)
  await seedRecord({
    recorderId: f,
    buildingId: A,
    location: 'B2 주차장 천장',
    defect: 'leak',
    repair: 'completed',
    note: '우천 후 누수, 실링 보수',
    daysAgo: 120,
  });
  await seedRecord({
    recorderId: f,
    buildingId: A,
    location: 'B2 주차장 천장',
    defect: 'leak',
    repair: 'completed',
    note: '같은 위치 재발, 드레인 청소',
    daysAgo: 45,
  });
  let b2Record = null;
  if (b2) {
    b2Record = await seedRecord({
      caseId: b2.b2CaseId,
      recorderId: f,
      buildingId: A,
      resultId: b2.b2ResultId,
      aiMatch: 'match',
      location: 'B2 주차장 천장',
      defect: 'leak',
      repair: 'pending',
      note: '천장 슬래브 균열부에서 누수. 전기 설비 아래 — 위험 표시',
      daysAgo: 1,
      risk: true,
    });
  }
  const r3f = await seedRecord({
    recorderId: f,
    buildingId: A,
    location: '3F 북측 외벽',
    defect: 'crack',
    repair: 'completed',
    note: '외벽 미세 균열 보수',
    daysAgo: 20,
  });
  await seedRecord({
    recorderId: f,
    buildingId: A,
    location: '2F 화장실 천장',
    defect: 'condensation',
    repair: 'pending',
    note: '환기팬 고장으로 결로',
    daysAgo: 10,
  });
  await seedRecord({
    recorderId: f,
    buildingId: A,
    location: '옥상 방수층',
    defect: 'leak',
    repair: 'pending',
    note: '방수층 들뜸',
    daysAgo: 30,
  });
  // 임시 저장(사진 없음) — 집계·검증 제외
  await seedRecord({
    recorderId: f,
    buildingId: A,
    location: '1F 로비 바닥',
    defect: 'crack',
    repair: 'pending',
    note: '사진 업로드 실패로 임시 저장',
    daysAgo: 0,
    save: false,
    photo: false,
  });
  // 연결 가능한 분석 결과(아직 기록 없음)
  await seedAnalysis({ ownerId: f, buildingId: A, photo: 'crack', result: 'crack', daysAgo: 0, description: '1F 로비 기둥 하부 균열' });
  // BLD-B — 기록 1건뿐(G7 시연)
  await seedRecord({
    recorderId: f,
    buildingId: ctx.b('BLD-B'),
    location: '101동 외벽 3F 북측',
    defect: 'crack',
    repair: 'completed',
    note: '외벽 미세 균열',
    daysAgo: 30,
  });
  // BLD-C — facility.c 기록
  await seedRecord({
    recorderId: ctx.u('facility.c@dev.local'),
    buildingId: ctx.b('BLD-C'),
    location: '하역장 바닥',
    defect: 'crack',
    repair: 'pending',
    note: '지게차 동선 균열',
    daysAgo: 15,
  });
  await seedRecord({
    recorderId: ctx.u('facility.c@dev.local'),
    buildingId: ctx.b('BLD-C'),
    location: '하역장 바닥',
    defect: 'crack',
    repair: 'pending',
    note: '균열 폭 증가',
    daysAgo: 3,
  });
  ctx.log.push('US3: BLD-A 저장 기록 6·임시 1·연결 가능 결과 1 · BLD-B 기록 1(G7) · BLD-C 기록 2');
  return { r3fRecordId: r3f.recordId, b2RecordId: b2Record?.recordId ?? null };
}

// ------------------------------------------------------------------ US4
export async function seedUs4(ctx: SeedContext) {
  const f = ctx.u('facility@dev.local');
  const ex = ctx.u('expert@dev.local');
  const A = ctx.b('BLD-A');
  await ensureMonthly(f);
  const mk = async (photo: any, result: any, loc: string, defect: any, days: number, note: string) => {
    const a = await seedAnalysis({ ownerId: f, buildingId: A, photo, result, daysAgo: days + 1, description: `${loc} 하자 사진` });
    const r = await seedRecord({
      caseId: a.caseId,
      recorderId: f,
      buildingId: A,
      resultId: a.resultId,
      aiMatch: 'mismatch',
      location: loc,
      defect,
      repair: 'pending',
      note,
      daysAgo: days,
    });
    return { ...a, ...r, itemId: await itemOf(r.recordId) };
  };
  await mk('crack', 'crack', '지하 1층 기둥', 'crack', 8, 'AI 는 표면 균열로 봤으나 현장은 기둥 피복 박리 동반 — 구조 균열 의심');
  await mk('condensation', 'condensation', '3F 화장실 천장', 'leak', 6, 'AI 는 결로로 봤으나 상층 배관 누수 확인');
  const dr = await mk('leak', 'leak_caution', '주차 램프 벽', 'crack', 4, '물자국보다 균열이 주원인으로 보임');
  await exec('INSERT INTO data_request (item_id, expert_id, reason, created_at, sent_at) VALUES (?, ?, ?, ?, ?)', [
    dr.itemId,
    ex,
    '균열 폭을 알 수 있도록 자(눈금)를 대고 가까이 다시 찍어 주세요',
    tsDaysAgo(1),
    tsDaysAgo(1),
  ]);
  await exec(
    "INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at) VALUES ('G6', ?, 'verification_item', ?, '균열 폭 확인 필요', ?)",
    [ex, dr.itemId, tsDaysAgo(1)],
  );
  await seedNotify(f, 'data_request', '추가 자료 요청: 주차 램프 벽 - 현장 사진을 더 올려 주세요', `/records/${dr.recordId}`, 1);
  // 판본 v1 match → v2 mismatch
  const vv = await mk('leak', 'leak', '옥상 방수층', 'leak', 25, 'AI 와 같은 판단이나 원인 순위가 다름');
  await seedVerdict(vv.itemId, ex, { verdict: 'match', opinion: '방수층 손상 누수로 판단 일치', daysAgo: 20 });
  await seedVerdict(vv.itemId, ex, {
    verdict: 'mismatch',
    opinion: '추가 현장 사진 확인 결과 드레인 막힘이 1순위 원인',
    diff: 'AI 1순위(방수층 손상) ≠ 현장 확인(드레인 막힘)',
    daysAgo: 18,
  });
  // 위험 큼 판정 → 위험 통지(verdict)
  const rh = await mk('crack', 'crack_danger', '2F 계단실 벽', 'crack', 3, '계단실 벽 사선 균열 — 진행 중');
  await seedVerdict(rh.itemId, ex, {
    verdict: 'mismatch',
    opinion: '전단 균열 양상, 구조 안전 점검 필요',
    diff: 'AI 위험도는 위험이나 원인을 하중 변화로만 봄 — 현장은 전단 균열',
    riskHigh: true,
    daysAgo: 2,
  });
  await seedNotify(
    ctx.u('building@dev.local'),
    'risk_notice',
    '위험 통지: 2F 계단실 벽 - 전문가가 위험이 크다고 판정했습니다',
    `/expert-requests/new?caseId=${rh.caseId}`,
    2,
  );
  ctx.log.push('US4: 검증 대기 2 · 자료 요청 1 · 판본 v1·v2 1 · 위험 큼 판정 1');
  return { verdictCaseId: rh.caseId };
}

// ------------------------------------------------------------------ US5
export async function seedUs5(ctx: SeedContext) {
  const a = await syncBuilding(ctx.b('BLD-A'));
  const c = await syncBuilding(ctx.b('BLD-C'));
  ctx.log.push(`US5: BLD-A 외부 이력 동기화 ${a.status}(+${a.added}) · BLD-C 동기화 ${c.status}(외부 이력 미반영)`);
}

// ------------------------------------------------------------------ US7
export async function seedUs7(ctx: SeedContext, rec: { r3fRecordId: number; b2RecordId: number | null }) {
  const A = ctx.b('BLD-A');
  const f = ctx.u('facility@dev.local');
  const bm = ctx.u('building@dev.local');
  const mk = async (item: string, cycle: string, due: string, created: number) => {
    const r = await exec(
      'INSERT INTO inspection_schedule (building_id, item_text, cycle_code, assignee_id, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [A, item, cycle, f, due, bm, tsDaysAgo(created)],
    );
    await exec("INSERT INTO schedule_alert (schedule_id, alert_kind, recipient_id, sent_at) VALUES (?, 'assigned', ?, ?)", [
      r.insertId,
      f,
      tsDaysAgo(created),
    ]);
    return r.insertId;
  };
  await mk('B2 주차장 배수 드레인 점검', 'month', daysFromToday(-1), 30); // 지연 — job:p0 로 알림
  await mk('옥상 방수층 상태 점검', 'quarter', daysFromToday(3), 20); // 도래
  await mk('외벽 균열 정기 관찰', 'half', daysFromToday(30), 10); // 예정
  const done = await mk('3F 북측 외벽 보수 확인', 'quarter', daysFromToday(-18), 40);
  await exec("UPDATE inspection_schedule SET schedule_status = 'completed', completed_record_id = ? WHERE schedule_id = ?", [
    rec.r3fRecordId,
    done,
  ]);
  if (rec.b2RecordId) {
    const risk = await mk('B2 주차장 천장 누수 긴급 점검', 'month', daysFromToday(0), 3);
    await exec("UPDATE inspection_schedule SET schedule_status = 'completed', completed_record_id = ? WHERE schedule_id = ?", [
      rec.b2RecordId,
      risk,
    ]);
    const cs = await queryOne<{ case_id: number }>('SELECT case_id FROM inspection_record WHERE record_id = ?', [rec.b2RecordId]);
    await exec("INSERT INTO risk_notice (case_id, source_kind, schedule_id, created_at) VALUES (?, 'inspection', ?, ?)", [
      cs!.case_id,
      risk,
      tsDaysAgo(1),
    ]);
  }
  const cancel = await mk('1F 로비 조명 점검(취소)', 'year', daysFromToday(-5), 25);
  await exec("UPDATE inspection_schedule SET schedule_status = 'cancelled', cancelled_at = ? WHERE schedule_id = ?", [
    tsDaysAgo(8),
    cancel,
  ]);
  ctx.log.push('US7: BLD-A 일정 6(지연·도래·예정·완료 2·취소) — npm run job:p0 로 도래·지연 알림');
}

// ------------------------------------------------------------------ US8
export async function seedUs8(ctx: SeedContext, opts: { verdictCaseId: number | null }) {
  const f = ctx.u('facility@dev.local');
  const bm = ctx.u('building@dev.local');
  const B = ctx.b('BLD-B');
  const ex = ctx.u('expert@dev.local');
  const arch = ctx.u('expert.arch@dev.local');
  await ensureMonthly(f);
  const share = await queryOne<{ notice_id: number }>(
    "SELECT notice_id FROM notice_text WHERE notice_kind = 'share' ORDER BY notice_id DESC LIMIT 1",
  );
  const scope = (caseNo: string) =>
    `하자 건 ${caseNo}의 사진, 사용자 설명, AI 분석 결과(원인·대응방안·위험도), 현장 점검 기록(위치·하자 종류·보수 결과), 건물명·건물 유형. 연락처는 연결이 확정된 뒤에만 양측에 공개됩니다.`;
  const reqFor = async (caseId: number, specialty: string, from: number, to: number, created: number) => {
    const n = await queryOne<{ risk_notice_id: number; source_kind: string }>(
      'SELECT risk_notice_id, source_kind FROM risk_notice WHERE case_id = ? AND closed_at IS NULL ORDER BY risk_notice_id DESC LIMIT 1',
      [caseId],
    );
    const c = await queryOne<{ case_no: string; building_id: number }>('SELECT case_no, building_id FROM defect_case WHERE case_id = ?', [
      caseId,
    ]);
    const r = await exec(
      'INSERT INTO expert_request (case_id, building_id, requester_id, origin_kind, risk_notice_id, specialty_code, wish_from, wish_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        caseId,
        c!.building_id,
        bm,
        n ? n.source_kind : 'direct',
        n?.risk_notice_id ?? null,
        specialty,
        daysFromToday(from),
        daysFromToday(to),
        tsDaysAgo(created),
      ],
    );
    return { id: r.insertId, caseNo: c!.case_no };
  };
  const attempt = async (reqId: number, caseNo: string, expertId: number, hoursAgo: number) => {
    const at = new Date(Date.now() + 9 * 3600_000 - hoursAgo * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
    const c = await exec(
      "INSERT INTO share_consent (exp_req_id, expert_id, scope_text, notice_id, notice_kind, consented_by, consented_at) VALUES (?, ?, ?, ?, 'share', ?, ?)",
      [reqId, expertId, scope(caseNo), share!.notice_id, bm, at],
    );
    const t = await exec('INSERT INTO expert_request_attempt (exp_req_id, expert_id, consent_id, sent_at) VALUES (?, ?, ?, ?)', [
      reqId,
      expertId,
      c.insertId,
      at,
    ]);
    return t.insertId;
  };

  // drafting — 위험 큼 판정 건(구조)
  if (opts.verdictCaseId) await reqFor(opts.verdictCaseId, 'structure', 0, 7, 0);

  // BLD-B 위험 건 2개 (분석 → 위험 통지)
  const b1 = await seedAnalysis({
    ownerId: f,
    buildingId: B,
    photo: 'leak',
    result: 'leak',
    daysAgo: 6,
    description: '101동 지하 기계실 천장 누수',
  });
  const b2 = await seedAnalysis({
    ownerId: f,
    buildingId: B,
    photo: 'crack',
    result: 'crack_danger',
    daysAgo: 9,
    description: '101동 필로티 기둥 균열',
  });
  const b3 = await seedAnalysis({
    ownerId: f,
    buildingId: B,
    photo: 'condensation',
    result: 'condensation',
    daysAgo: 4,
    description: '101동 경비실 결로',
  });

  // awaiting — expert@ 에게 2시간 전 전달
  const aw = await reqFor(b3.caseId, 'waterproof', 0, 10, 0);
  const awT = await attempt(aw.id, aw.caseNo, ex, 2);
  await seedNotify(ex, 'expert_attempt', `새 점검 요청: ${aw.caseNo} (방수)`, `/expert-inbox?attemptId=${awT}`, 0);

  // not_confirmed — expert.arch@ 거절
  const nc = await reqFor(b2.caseId, 'structure', 0, 7, 3);
  const ncT = await attempt(nc.id, nc.caseNo, arch, 60);
  await exec(
    "UPDATE expert_request_attempt SET response = 'declined', responded_at = ?, decline_reason = '해당 기간 현장 일정이 이미 차 있습니다' WHERE attempt_id = ?",
    [tsDaysAgo(2, 15), ncT],
  );
  await exec(
    "INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at) VALUES ('G10', ?, 'expert_request_attempt', ?, '전문가 거절', ?)",
    [arch, ncT, tsDaysAgo(2, 15)],
  );
  await seedNotify(
    bm,
    'expert_declined',
    `전문가가 요청을 거절했습니다: ${nc.caseNo} - 다른 후보에게 요청할 수 있습니다`,
    `/expert-requests/${nc.id}`,
    2,
  );

  // connected — expert@ 수락, 수수료 NULL(요율 미설정) · 트리거가 위험 통지 종료
  const cn = await reqFor(b1.caseId, 'waterproof', 0, 7, 5);
  const cnT = await attempt(cn.id, cn.caseNo, ex, 100);
  await exec("UPDATE expert_request_attempt SET response = 'accepted', responded_at = ? WHERE attempt_id = ?", [tsDaysAgo(4, 9), cnT]);
  await exec('INSERT INTO expert_connection (attempt_id, fee_amount, confirmed_at) VALUES (?, NULL, ?)', [cnT, tsDaysAgo(4, 9)]);
  ctx.log.push('US8: 요청 drafting·awaiting·not_confirmed·connected 각 1 · 열린 위험 통지(BLD-A B2·계단실·정기점검, BLD-B 2)');
}

// ------------------------------------------------------------------ US6
export async function seedUs6(ctx: SeedContext) {
  const ent = ctx.u('enterprise@dev.local');
  const run = await createRun(
    ctx.orgs.get('ORG-HB')!,
    ent,
    [ctx.b('BLD-A'), ctx.b('BLD-B'), ctx.b('BLD-C'), ctx.b('BLD-D')],
    daysFromToday(-365),
    daysFromToday(0),
  );
  await exec('UPDATE priority_run SET created_at = ? WHERE run_id = ?', [tsDaysAgo(2), run]);
  const n = await query('SELECT priority_rank FROM priority_item WHERE run_id = ?', [run]);
  ctx.log.push(`US6: 과거 우선순위 스냅숏 1건(항목 ${n.length}, 권한 밖 1개 제외, 외부 미반영) · 새솔관리 라이선스 만료`);
}
