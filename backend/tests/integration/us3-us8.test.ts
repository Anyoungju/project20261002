import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedFixture, done, as, photo, waitAnalysis, giveMonthly, Fixture, Client } from './helpers';
import { exec, query, queryOne } from '../../src/db/pool';
import { runP0Watch } from '../../src/modules/schedule/scheduleService';
import { runNoResponse } from '../../src/modules/expert/expertService';

let fx: Fixture;
let fac: Client;
let resultCaseId = 0;
let resultId = 0;
let mismatchRecordId = 0;
let itemId = 0;

beforeAll(async () => {
  fx = await seedFixture();
  await giveMonthly(fx.users.facility);
  fac = await as('facility');
  // 건물 A 의 위험 분석 결과 하나
  const r = await fac.upload('/api/analysis-requests', [await photo('leak')], {
    description: '#danger',
    buildingId: String(fx.buildings.A),
  });
  expect(r.status).toBe(201);
  const d = (await waitAnalysis(fac, r.body.requestId)).body;
  resultCaseId = d.caseId;
  resultId = d.result.resultId;
});
afterAll(() => done());

async function newRecord(
  c: Client,
  buildingId: number,
  opts: { resultId?: number; aiMatch?: string; loc?: string; defect?: string; repair?: string; risk?: boolean; photo?: boolean } = {},
) {
  const created = await c.post('/api/records', { buildingId, resultId: opts.resultId ?? null });
  expect(created.status).toBe(201);
  const id = created.body.recordId;
  await c.patch(`/api/records/${id}`, {
    locationText: opts.loc ?? 'B2 주차장 천장',
    defectTypeCode: opts.defect ?? 'leak',
    repairStatus: opts.repair ?? 'pending',
    aiMatch: opts.resultId ? (opts.aiMatch ?? 'match') : 'none',
    riskFlag: !!opts.risk,
  });
  if (opts.photo !== false) expect((await c.upload(`/api/records/${id}/photos`, [await photo('leak')])).status).toBe(201);
  return id;
}

describe('US3 현장 기록', () => {
  it('필수 누락 저장은 G5 + 누락 목록(SC-008), 저장된 기록 0건', async () => {
    const created = await fac.post('/api/records', { buildingId: fx.buildings.A });
    const id = created.body.recordId;
    const r = await fac.post(`/api/records/${id}/save`, {});
    expect(r.status).toBe(422);
    expect(r.body.gate).toBe('G5');
    expect(r.body.missingFields).toEqual(expect.arrayContaining(['location', 'defectType', 'repairStatus', 'photo']));
    const rec = await queryOne('SELECT record_status FROM inspection_record WHERE record_id = ?', [id]);
    expect(rec!.record_status).toBe('draft');
  });

  it('불일치 저장 → 즉시 검증 대기(SC-009), 비회원 결과는 연결 불가', async () => {
    mismatchRecordId = await newRecord(fac, fx.buildings.A, { resultId, aiMatch: 'mismatch' });
    const s = await fac.post(`/api/records/${mismatchRecordId}/save`, {});
    expect(s.status).toBe(200);
    expect(s.body.recordStatus).toBe('saved');
    const item = await queryOne<{ item_id: number; item_status: string }>(
      'SELECT item_id, item_status FROM verification_item WHERE record_id = ?',
      [mismatchRecordId],
    );
    expect(item!.item_status).toBe('waiting');
    itemId = item!.item_id;
    const ex = await as('expert');
    expect((await ex.get('/api/verification-items')).body.some((x: any) => x.itemId === itemId)).toBe(true);
  });

  it('보수 결과는 미완료→완료만, 이력 기록 · 저장 기록은 임시로 못 돌아감', async () => {
    const id = await newRecord(fac, fx.buildings.A, { loc: '3F 북측 외벽', defect: 'crack' });
    await fac.post(`/api/records/${id}/save`, {});
    expect((await fac.patch(`/api/records/${id}/repair-status`, { repairStatus: 'completed' })).status).toBe(200);
    expect((await fac.patch(`/api/records/${id}/repair-status`, { repairStatus: 'pending' })).status).toBe(409);
    const log = await query('SELECT * FROM record_repair_log WHERE record_id = ?', [id]);
    expect(log).toHaveLength(1);
    await expect(exec("UPDATE inspection_record SET record_status = 'draft' WHERE record_id = ?", [id])).rejects.toThrow(
      /cannot return to draft/,
    );
  });

  it('권한 없는 건물 기록은 403 G0', async () => {
    const r = await fac.post('/api/records', { buildingId: fx.buildings.X });
    expect(r.status).toBe(403);
    expect(r.body.gate).toBe('G0');
  });
});

describe('US4 전문가 검증', () => {
  it('판정 불가 → 자료 요청, 열린 동안 판정 G6, 사진 추가 시 자동 해소', async () => {
    const ex = await as('expert');
    const dr = await ex.post(`/api/verification-items/${itemId}/data-requests`, { reason: '자를 대고 다시 찍어 주세요' });
    expect(dr.status).toBe(201);
    expect(dr.body.status).toBe('data_requested');
    const v = await ex.post(`/api/verification-items/${itemId}/verdicts`, { verdict: 'match' });
    expect(v.status).toBe(409);
    expect(v.body.gate).toBe('G6');
    expect((await fac.upload(`/api/records/${mismatchRecordId}/photos`, [await photo('leak')])).status).toBe(201);
    expect((await ex.get(`/api/verification-items/${itemId}`)).body.status).toBe('waiting');
  });

  it('판본 누적(덮어쓰기 없음), 불일치는 차이 필수, 위험 큼 → 위험 통지', async () => {
    const ex = await as('expert');
    expect((await ex.post(`/api/verification-items/${itemId}/verdicts`, { verdict: 'mismatch' })).status).toBe(422);
    await ex.post(`/api/verification-items/${itemId}/verdicts`, { verdict: 'match', opinion: '일치' });
    const r = await ex.post(`/api/verification-items/${itemId}/verdicts`, {
      verdict: 'mismatch',
      diffNote: '원인 순위 차이',
      riskHigh: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.verdicts.map((x: any) => x.versionNo)).toEqual([2, 1]);
    const n = await queryOne("SELECT COUNT(*) AS n FROM risk_notice WHERE source_kind = 'verdict' AND case_id = ?", [resultCaseId]);
    expect(Number(n!.n)).toBe(1);
  });

  it('신뢰도 지표는 판정 불가를 분모에서 제외(SC-010)', async () => {
    const ex = await as('expert');
    const m = (await ex.get('/api/trust-metrics')).body;
    expect(m.overall.verdictCount).toBeGreaterThan(0);
    expect(typeof m.excludedUnableCount).toBe('number');
  });
});

describe('US5 건물 이력', () => {
  it('연동 실패여도 내부 이력 200 + 외부 미반영(SC-011), 중복 적재 없음', async () => {
    const b = await as('building');
    const h = await b.get(`/api/buildings/${fx.buildings.B}/history`);
    expect(h.status).toBe(200);
    await b.post(`/api/buildings/${fx.buildings.B}/bms-sync`);
    const h2 = (await b.get(`/api/buildings/${fx.buildings.B}/history`)).body;
    expect(h2.source.externalMissing).toBe(true);
    await b.post(`/api/buildings/${fx.buildings.A}/bms-sync`);
    await b.post(`/api/buildings/${fx.buildings.A}/bms-sync`);
    const n = await queryOne('SELECT COUNT(*) AS n FROM external_history WHERE building_id = ?', [fx.buildings.A]);
    expect(Number(n!.n)).toBe(3);
  });

  it('G7: 이력 부족이면 패턴 미반환, 충분하면 반복 하자', async () => {
    const b = await as('building');
    const g7 = (await b.get(`/api/buildings/${fx.buildings.B}/repeat-defects`)).body;
    expect(g7.blocked).toBe(true);
    expect(g7.gate.gate).toBe('G7');
    expect(g7.patterns).toHaveLength(0);
    const ok = (await b.get(`/api/buildings/${fx.buildings.A}/repeat-defects`)).body;
    expect(ok.blocked).toBe(false);
    expect(ok.patterns.some((p: any) => p.locationText === 'B2 주차장 천장' && p.occurrenceCount >= 2)).toBe(true);
  });
});

describe('US7 정기점검', () => {
  it('지연 일정은 job 1회로 담당자·관리자 알림(SC-013), 취소 일정 알림 0건', async () => {
    const b = await as('building');
    const mk = async (due: string) =>
      (
        await b.post(`/api/buildings/${fx.buildings.A}/schedules`, {
          itemText: `테스트 점검 ${due}`,
          cycleCode: 'month',
          assigneeId: fx.users.facility,
          dueDate: due,
        })
      ).body.scheduleId;
    const yesterday = new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10);
    const overdue = await mk(yesterday);
    const cancelled = await mk(yesterday);
    await b.post(`/api/schedules/${cancelled}/cancel`);
    await runP0Watch();
    const a1 = await query("SELECT alert_kind FROM schedule_alert WHERE schedule_id = ? AND alert_kind = 'overdue'", [overdue]);
    expect(a1).toHaveLength(1);
    const a2 = await query("SELECT alert_kind FROM schedule_alert WHERE schedule_id = ? AND alert_kind IN ('due','overdue')", [cancelled]);
    expect(a2).toHaveLength(0);
    const list = (await b.get(`/api/buildings/${fx.buildings.A}/schedules`)).body.schedules;
    expect(list.find((s: any) => s.scheduleId === overdue).displayStatus).toBe('overdue');
  });

  it('완료는 같은 건물의 저장 기록만, 위험 표시 기록이면 위험 통지(inspection)', async () => {
    const b = await as('building');
    const sid = (
      await b.post(`/api/buildings/${fx.buildings.A}/schedules`, {
        itemText: '완료 테스트',
        assigneeId: fx.users.facility,
        dueDate: '2030-01-01',
      })
    ).body.scheduleId;
    const otherRec = await newRecord(fac, fx.buildings.B, { loc: 'x', defect: 'crack' });
    await fac.post(`/api/records/${otherRec}/save`, {});
    expect((await fac.post(`/api/schedules/${sid}/complete`, { recordId: otherRec })).status).toBe(422);
    const rec = await newRecord(fac, fx.buildings.A, { loc: '옥상', defect: 'leak', risk: true });
    const s = await fac.post(`/api/records/${rec}/save`, { scheduleId: sid });
    expect(s.body.completedScheduleId).toBe(sid);
    const n = await queryOne("SELECT COUNT(*) AS n FROM risk_notice WHERE source_kind = 'inspection' AND schedule_id = ?", [sid]);
    expect(Number(n!.n)).toBe(1);
  });
});

describe('US8 전문가 연결', () => {
  let reqId = 0;
  it('일반·시설관리자는 요청 불가(FR-121)', async () => {
    expect(
      (
        await fac.post('/api/expert-requests', {
          caseId: resultCaseId,
          specialtyCode: 'waterproof',
          wishFrom: '2030-01-01',
          wishTo: '2030-01-02',
        })
      ).status,
    ).toBe(403);
  });
  it('후보 없음 G8 → 조건 변경 → 동의 없이 확정 G9(전달 0건) → 동의 후 확정 → 수락 → 연결·통지 종료(SC-014)', async () => {
    const b = await as('building');
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const created = await b.post('/api/expert-requests', {
      caseId: resultCaseId,
      specialtyCode: 'architecture',
      wishFrom: '2099-01-01',
      wishTo: '2099-01-02',
    });
    expect(created.status).toBe(201);
    reqId = created.body.expReqId;
    expect(created.body.riskNoticeId).toBeTruthy();
    const none = (await b.get(`/api/expert-requests/${reqId}/candidates`)).body;
    expect(none.gate.gate).toBe('G8');
    await b.patch(`/api/expert-requests/${reqId}`, { specialtyCode: 'waterproof', wishFrom: today, wishTo: today });
    const cands = (await b.get(`/api/expert-requests/${reqId}/candidates`)).body.candidates;
    expect(cands.map((c: any) => c.expertId)).toContain(fx.users.expert);
    expect(JSON.stringify(cands)).not.toContain('@test.buildcare.local');
    const pv = (await b.get(`/api/expert-requests/${reqId}/preview?expertId=${fx.users.expert}`)).body;
    const g9 = await b.post(`/api/expert-requests/${reqId}/confirm`, {
      expertId: fx.users.expert,
      consent: false,
      scopeText: pv.scopeText,
      noticeId: pv.notice.noticeId,
    });
    expect(g9.status).toBe(409);
    expect(g9.body.gate).toBe('G9');
    expect(await query('SELECT * FROM expert_request_attempt WHERE exp_req_id = ?', [reqId])).toHaveLength(0);
    const ok = await b.post(`/api/expert-requests/${reqId}/confirm`, {
      expertId: fx.users.expert,
      consent: true,
      scopeText: pv.scopeText,
      noticeId: pv.notice.noticeId,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('awaiting');
    const ex = await as('expert');
    const inbox = (await ex.get('/api/me/expert-attempts')).body;
    const att = inbox.find((a: any) => a.expReqId === reqId);
    const detail = (await ex.get(`/api/expert-attempts/${att.attemptId}`)).body;
    expect(detail.contact).toBeNull();
    const acc = await ex.post(`/api/expert-attempts/${att.attemptId}/respond`, { response: 'accepted' });
    expect(acc.status).toBe(200);
    expect(acc.body.connection.feeAmount).toBeNull(); // 요율 미설정 → 수수료 미기록
    const fin = (await b.get(`/api/expert-requests/${reqId}`)).body;
    expect(fin.status).toBe('connected');
    const n = await queryOne('SELECT closed_at, close_reason FROM risk_notice WHERE risk_notice_id = ?', [fin.riskNoticeId]);
    expect(n!.close_reason).toBe('connected');
  });
  it('수락 없는 연결 삽입은 트리거가 거부(G10)', async () => {
    const t = await queryOne<{ attempt_id: number }>('SELECT attempt_id FROM expert_request_attempt WHERE exp_req_id = ?', [reqId]);
    await expect(exec('INSERT INTO expert_connection (attempt_id) VALUES (?)', [t!.attempt_id])).rejects.toThrow();
  });
  it('응답 시한 미설정이면 무응답 자동 판정 없음', async () => {
    const prev = await queryOne<{ const_value: string | null }>(
      "SELECT const_value FROM service_constant WHERE const_key = 'expert_response_hours'",
    );
    await exec("UPDATE service_constant SET const_value = NULL WHERE const_key = 'expert_response_hours'");
    expect((await runNoResponse()).updated).toBe(0);
    await exec("UPDATE service_constant SET const_value = ? WHERE const_key = 'expert_response_hours'", [prev?.const_value ?? null]);
  });
});

describe('US6 우선순위', () => {
  it('스냅숏: 근거 ≥1(SC-012) · 고지 · 권한 밖 제외 수 · 외부 미반영 · 재조회 불변', async () => {
    const e = await as('enterprise');
    const r = await e.post('/api/priority-runs', {
      buildingIds: [fx.buildings.A, fx.buildings.B, fx.buildings.X],
      periodFrom: '2025-01-01',
      periodTo: '2030-12-31',
    });
    expect(r.status).toBe(201);
    expect(r.body.notice.kind).toBe('priority');
    expect(r.body.excludedBuildingCount).toBe(1);
    expect(r.body.externalIncluded).toBe(false);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const it of r.body.items) expect(it.basis.length).toBeGreaterThanOrEqual(1);
    await newRecord(fac, fx.buildings.A, { loc: '새 위치', defect: 'crack' }).then((id) => fac.post(`/api/records/${id}/save`, {}));
    const again = (await e.get(`/api/priority-runs/${r.body.runId}`)).body;
    expect(again.items.length).toBe(r.body.items.length);
    expect((await e.patch(`/api/priority-runs/${r.body.runId}/items/1`, { action: 'expert' })).body.items[0].assignedAction).toBe('expert');
  });
  it('라이선스 만료 조직은 G0', async () => {
    const x = await as('enterpriseX');
    const r = await x.get('/api/org/dashboard');
    expect(r.status).toBe(403);
    expect(r.body.gate).toBe('G0');
    expect(r.body.reason).toContain('라이선스');
  });
});
