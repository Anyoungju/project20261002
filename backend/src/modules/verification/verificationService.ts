import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { gateError, buildBlock } from '../../gates/gateBlock';
import { resultDto, analysisPhotos, recordPhotos, caseProgress } from '../case/caseService';
import { maskedUsers } from '../../lib/mask';
import { notify } from '../notification/notificationService';
import { HttpError, notFound } from '../../lib/http';

/** FR-040 — v_verification_queue (대기·자료 요청) + 선택 시 완료 건 */
export async function queue(f: { defectType?: string; status?: string }) {
  if (f.status === 'verified') {
    const rows = await query(
      `SELECT i.item_id, c.case_no, r.defect_type_code, d.defect_type_name, i.item_status, i.created_at,
              (SELECT ac.cause_text FROM analysis_cause ac WHERE ac.result_id = i.result_id AND ac.cause_rank = 1) AS ai_top_cause,
              r.inspection_note AS field_note, b.building_name
         FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id JOIN defect_case c ON c.case_id = r.case_id
         JOIN building b ON b.building_id = r.building_id LEFT JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code
        WHERE i.item_status = 'verified' ${f.defectType ? 'AND r.defect_type_code = ?' : ''}
        ORDER BY i.item_id DESC LIMIT 100`,
      f.defectType ? [f.defectType] : [],
    );
    return rows.map(mapQueue);
  }
  const rows = await query(
    `SELECT q.item_id, q.case_no, q.defect_type_code, d.defect_type_name, q.item_status, q.ai_top_cause, q.field_note, q.created_at, b.building_name
       FROM v_verification_queue q
       JOIN verification_item i ON i.item_id = q.item_id JOIN inspection_record r ON r.record_id = i.record_id
       JOIN building b ON b.building_id = r.building_id
       LEFT JOIN defect_type_code d ON d.defect_type_code = q.defect_type_code
      WHERE 1 = 1 ${f.defectType ? 'AND q.defect_type_code = ?' : ''} ${f.status ? 'AND q.item_status = ?' : ''}
      ORDER BY FIELD(q.item_status, 'waiting', 'data_requested'), q.created_at`,
    [...(f.defectType ? [f.defectType] : []), ...(f.status ? [f.status] : [])],
  );
  return rows.map(mapQueue);
}

function mapQueue(r: any) {
  return {
    itemId: r.item_id,
    caseNo: r.case_no,
    buildingName: r.building_name,
    defectTypeCode: r.defect_type_code,
    defectTypeName: r.defect_type_name,
    status: r.item_status,
    aiTopCause: r.ai_top_cause,
    fieldNote: r.field_note,
    createdAt: r.created_at,
  };
}

export async function itemDetail(itemId: number) {
  const i = await queryOne<{ item_id: number; record_id: number; result_id: number; item_status: string; created_at: string }>(
    'SELECT item_id, record_id, result_id, item_status, created_at FROM verification_item WHERE item_id = ?',
    [itemId],
  );
  if (!i) return null;
  const r: any = await queryOne(
    `SELECT r.*, d.defect_type_name, c.case_no, b.building_name, t.building_type_name
       FROM inspection_record r JOIN defect_case c ON c.case_id = r.case_id JOIN building b ON b.building_id = r.building_id
       JOIN building_type_code t ON t.building_type_code = b.building_type_code
       LEFT JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code WHERE r.record_id = ?`,
    [i.record_id],
  );
  if (!r) return null;
  const result = await resultDto(i.result_id);
  const req = await queryOne<{ description: string | null }>('SELECT description FROM analysis_request WHERE request_id = ?', [
    result.requestId,
  ]);
  const verdicts = await query(
    'SELECT verdict_id, version_no, expert_id, verdict, opinion, diff_note, risk_high, decided_at FROM expert_verdict WHERE item_id = ? ORDER BY version_no DESC',
    [itemId],
  );
  const reqs = await query(
    'SELECT data_req_id, expert_id, reason, sent_at, resolved_at FROM data_request WHERE item_id = ? ORDER BY data_req_id DESC',
    [itemId],
  );
  const people = await maskedUsers([...verdicts.map((v) => v.expert_id), ...reqs.map((d) => d.expert_id), r.recorder_id]);
  const open = reqs.find((d) => !d.resolved_at);
  const gate = open
    ? await buildBlock('G6', {
        record: false,
        reason: `추가 자료 요청 중: ${open.reason}`,
        actions: [],
      })
    : null;
  return {
    itemId: i.item_id,
    status: i.item_status,
    createdAt: i.created_at,
    caseId: r.case_id,
    caseNo: r.case_no,
    gate,
    analysis: {
      description: req?.description ?? null,
      result,
      photos: await analysisPhotos(result.requestId, undefined, { defect: r.defect_type_name, location: r.location_text }),
    },
    record: {
      recordId: r.record_id,
      buildingName: r.building_name,
      buildingTypeName: r.building_type_name,
      locationText: r.location_text,
      defectTypeCode: r.defect_type_code,
      defectTypeName: r.defect_type_name,
      repairStatus: r.repair_status,
      repairMethod: r.repair_method,
      inspectionNote: r.inspection_note,
      aiMatch: r.ai_match,
      savedAt: r.saved_at,
      recorder: people.get(r.recorder_id) ?? null,
      photos: await recordPhotos(r.record_id, undefined, { defect: r.defect_type_name, location: r.location_text }),
    },
    verdicts: verdicts.map((v) => ({
      verdictId: v.verdict_id,
      versionNo: v.version_no,
      verdict: v.verdict,
      opinion: v.opinion,
      diffNote: v.diff_note,
      riskHigh: !!v.risk_high,
      decidedAt: v.decided_at,
      expert: people.get(v.expert_id) ?? null,
      current: v.version_no === verdicts[0]?.version_no,
    })),
    dataRequests: reqs.map((d) => ({
      dataReqId: d.data_req_id,
      reason: d.reason,
      sentAt: d.sent_at,
      resolvedAt: d.resolved_at,
      open: !d.resolved_at,
      expert: people.get(d.expert_id) ?? null,
    })),
    progress: await caseProgress(r.case_id),
  };
}

/** FR-041 · FR-042 — 판본 누적. item_id 는 값으로 넘긴다(ERROR 1442 규약) */
export async function saveVerdict(
  itemId: number,
  expertId: number,
  v: { verdict: 'match' | 'mismatch'; opinion?: string | null; diffNote?: string | null; riskHigh?: boolean },
) {
  const item = await queryOne<{ item_id: number }>('SELECT item_id FROM verification_item WHERE item_id = ?', [itemId]);
  if (!item) throw notFound('검증 대상을 찾을 수 없습니다');
  const open = await queryOne<{ reason: string }>('SELECT reason FROM data_request WHERE item_id = ? AND resolved_at IS NULL LIMIT 1', [
    itemId,
  ]);
  if (open) {
    throw await gateError('G6', {
      reason: `추가 자료 요청이 열려 있습니다: ${open.reason}`,
      actorId: expertId,
      subject: { kind: 'verification_item', id: itemId },
    });
  }
  if (v.verdict === 'mismatch' && !v.diffNote?.trim()) {
    throw new HttpError(422, 'diff_required', '불일치 판정에는 AI 와의 차이 내용을 적어 주세요', { missingFields: ['diffNote'] });
  }
  const verdictId = await withTransaction(async (conn) => {
    const r = await exec(
      'INSERT INTO expert_verdict (item_id, version_no, expert_id, verdict, opinion, diff_note, risk_high) VALUES (?, 0, ?, ?, ?, ?, ?)',
      [
        itemId,
        expertId,
        v.verdict,
        v.opinion?.trim() || null,
        v.verdict === 'mismatch' ? v.diffNote!.trim() : v.diffNote?.trim() || null,
        !!v.riskHigh,
      ],
      conn,
    );
    return r.insertId;
  });
  if (v.riskHigh) {
    // FR-046 — 트리거가 위험 통지를 만들었다. 해당 건물 관리자에게 알림
    const b = await queryOne<{ building_id: number; case_id: number; case_no: string }>(
      `SELECT r.building_id, r.case_id, c.case_no FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
         JOIN defect_case c ON c.case_id = r.case_id WHERE i.item_id = ?`,
      [itemId],
    );
    if (b) {
      const managers = await query<{ user_id: number }>(
        `SELECT DISTINCT a.user_id FROM v_access_check a JOIN user_role r ON r.user_id = a.user_id AND r.role_code = 'building'
          WHERE a.building_id = ? AND a.access_kind = 'manage'`,
        [b.building_id],
      );
      for (const m of managers) {
        await notify(
          m.user_id,
          'risk_notice',
          { kind: 'expert_verdict', id: verdictId },
          `위험 통지: ${b.case_no} 전문가가 위험이 크다고 판정했습니다`,
          `/expert-requests/new?caseId=${b.case_id}`,
        );
      }
    }
  }
  return verdictId;
}

/** FR-043 — 판정 불가 = 판정이 아니라 자료 요청. 작성 시설관리자에게 전달 */
export async function requestData(itemId: number, expertId: number, reason: string) {
  const r = await queryOne<{ recorder_id: number; record_id: number; case_no: string }>(
    `SELECT r.recorder_id, r.record_id, c.case_no FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
       JOIN defect_case c ON c.case_id = r.case_id WHERE i.item_id = ?`,
    [itemId],
  );
  if (!r) throw notFound('검증 대상을 찾을 수 없습니다');
  const open = await queryOne('SELECT 1 AS x FROM data_request WHERE item_id = ? AND resolved_at IS NULL', [itemId]);
  if (open) throw new HttpError(409, 'already_requested', '이미 열린 추가 자료 요청이 있습니다');
  const ins = await exec('INSERT INTO data_request (item_id, expert_id, reason, sent_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [
    itemId,
    expertId,
    reason.trim().slice(0, 200),
  ]);
  await gateError('G6', { reason: reason.trim().slice(0, 200), actorId: expertId, subject: { kind: 'verification_item', id: itemId } });
  await notify(
    r.recorder_id,
    'data_request',
    { kind: 'data_request', id: ins.insertId },
    `추가 자료 요청: ${r.case_no} 현장 사진을 더 올려 주세요`,
    `/records/${r.record_id}`,
  );
  return ins.insertId;
}

/** FR-045 — v_ai_trust_metric (판정 불가 제외) */
export async function trustMetrics() {
  const rows = await query<{ defect_type_code: string; defect_type_name: string; verdict_count: number; mismatch_count: number }>(
    `SELECT m.defect_type_code, d.defect_type_name, m.verdict_count, m.mismatch_count
       FROM v_ai_trust_metric m JOIN defect_type_code d ON d.defect_type_code = m.defect_type_code ORDER BY m.defect_type_code`,
  );
  const unable = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM verification_item WHERE item_status = 'data_requested'");
  const total = rows.reduce((s, r) => s + Number(r.verdict_count), 0);
  const mism = rows.reduce((s, r) => s + Number(r.mismatch_count), 0);
  return {
    overall: { verdictCount: total, mismatchCount: mism, matchRate: total ? Math.round(((total - mism) / total) * 1000) / 10 : null },
    excludedUnableCount: Number(unable?.n ?? 0),
    byDefectType: rows.map((r) => ({
      defectTypeCode: r.defect_type_code,
      defectTypeName: r.defect_type_name,
      verdictCount: Number(r.verdict_count),
      mismatchCount: Number(r.mismatch_count),
      matchRate: Number(r.verdict_count)
        ? Math.round(((Number(r.verdict_count) - Number(r.mismatch_count)) / Number(r.verdict_count)) * 1000) / 10
        : null,
    })),
  };
}
