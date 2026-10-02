import { exec, query, queryOne, Db, getPool } from '../../db/pool';
import { signFileUrl } from '../../adapters/storage';
import { noticeById, NoticeDto } from '../reference/referenceRouter';

/** 건 번호 D-YYYY-NNNN — case_no_seq FOR UPDATE (트랜잭션 안에서 호출) */
export async function nextCaseNo(conn: Db): Promise<string> {
  const year = new Date().getFullYear();
  await exec('INSERT INTO case_no_seq (seq_year, last_no) VALUES (?, 0) ON DUPLICATE KEY UPDATE seq_year = seq_year', [year], conn);
  const r = await queryOne<{ last_no: number }>('SELECT last_no FROM case_no_seq WHERE seq_year = ? FOR UPDATE', [year], conn);
  const n = (r?.last_no ?? 0) + 1;
  await exec('UPDATE case_no_seq SET last_no = ? WHERE seq_year = ?', [n, year], conn);
  return `D-${year}-${String(n).padStart(4, '0')}`;
}

export async function createCase(conn: Db, ownerId: number, buildingId: number | null): Promise<{ caseId: number; caseNo: string }> {
  const caseNo = await nextCaseNo(conn);
  const r = await exec('INSERT INTO defect_case (case_no, owner_id, building_id) VALUES (?, ?, ?)', [caseNo, ownerId, buildingId], conn);
  return { caseId: r.insertId, caseNo };
}

export interface ResultDto {
  resultId: number;
  requestId: number;
  riskLevel: 'normal' | 'caution' | 'danger';
  aiConfidence: number | null;
  lowConfidence: boolean;
  causes: Array<{ rank: number; text: string }>;
  actions: Array<{ seq: number; text: string }>;
  notice: NoticeDto;
  completedAt: string;
  recommendExpert: boolean;
}

export async function aiLowConfidence(db: Db = getPool()): Promise<number | null> {
  const r = await queryOne<{ const_value: string | null }>(
    "SELECT const_value FROM service_constant WHERE const_key = 'ai_low_confidence'",
    [],
    db,
  );
  return r?.const_value == null ? null : Number(r.const_value);
}

/** FR-014 — 결과는 고지와 함께만 직렬화한다(고지 없으면 throw) */
export async function resultDto(resultId: number, db: Db = getPool()): Promise<ResultDto> {
  const r = await queryOne<{
    result_id: number;
    request_id: number;
    notice_id: number;
    risk_level: any;
    ai_confidence: number | null;
    completed_at: string;
  }>(
    'SELECT result_id, request_id, notice_id, risk_level, ai_confidence, completed_at FROM analysis_result WHERE result_id = ?',
    [resultId],
    db,
  );
  if (!r) throw new Error('result not found');
  const notice = await noticeById(r.notice_id, db);
  if (!notice) throw new Error('BR-DEF-01: 고지 없는 결과는 표시할 수 없습니다');
  const causes = await query<{ cause_rank: number; cause_text: string }>(
    'SELECT cause_rank, cause_text FROM analysis_cause WHERE result_id = ? ORDER BY cause_rank',
    [resultId],
    db,
  );
  const actions = await query<{ action_seq: number; action_text: string }>(
    'SELECT action_seq, action_text FROM analysis_action WHERE result_id = ? ORDER BY action_seq',
    [resultId],
    db,
  );
  const low = await aiLowConfidence(db);
  const lowConfidence = low != null && r.ai_confidence != null && Number(r.ai_confidence) < low;
  return {
    resultId: r.result_id,
    requestId: r.request_id,
    riskLevel: r.risk_level,
    aiConfidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
    lowConfidence,
    causes: causes.map((c) => ({ rank: c.cause_rank, text: c.cause_text })),
    actions: actions.map((a) => ({ seq: a.action_seq, text: a.action_text })),
    notice,
    completedAt: r.completed_at,
    recommendExpert: r.risk_level !== 'normal' || lowConfidence,
  };
}

export async function caseProgress(caseId: number, db: Db = getPool()) {
  const p = await queryOne('SELECT * FROM v_case_progress WHERE case_id = ?', [caseId], db);
  if (!p) return null;
  return {
    caseId: p.case_id,
    caseNo: p.case_no,
    stages: [
      { key: 'analysis', label: '분석', state: p.stage1_analysis },
      { key: 'record', label: '현장 기록', state: p.stage2_record },
      { key: 'verify', label: '전문가 검증', state: p.stage3_verify },
      { key: 'action', label: '조치', state: p.stage4_action },
    ],
  };
}

export interface PhotoDto {
  kind: 'analysis' | 'record';
  photoId: number;
  url: string;
  expiresAt: string;
  alt: string;
  takenAt: string | null;
}

export function photoAlt(defectName: string | null, location: string | null, date: string | null): string {
  return `${defectName ?? '하자'} - ${location ?? '위치 미기재'} - ${(date ?? '').slice(0, 10) || '촬영일 미상'}`;
}

export async function analysisPhotos(requestId: number, db: Db = getPool(), alt?: { defect?: string | null; location?: string | null }) {
  const rows = await query<{ photo_id: number; storage_key: string; taken_at: string | null; uploaded_at: string }>(
    'SELECT photo_id, storage_key, taken_at, uploaded_at FROM analysis_photo WHERE request_id = ? ORDER BY photo_id',
    [requestId],
    db,
  );
  return rows.map<PhotoDto>((p) => ({
    kind: 'analysis',
    photoId: p.photo_id,
    ...signFileUrl(p.storage_key),
    takenAt: p.taken_at,
    alt: photoAlt(alt?.defect ?? null, alt?.location ?? null, p.taken_at ?? p.uploaded_at),
  }));
}

export async function recordPhotos(recordId: number, db: Db = getPool(), alt?: { defect?: string | null; location?: string | null }) {
  const rows = await query<{ photo_id: number; storage_key: string; uploaded_at: string }>(
    'SELECT photo_id, storage_key, uploaded_at FROM record_photo WHERE record_id = ? ORDER BY photo_id',
    [recordId],
    db,
  );
  return rows.map<PhotoDto>((p) => ({
    kind: 'record',
    photoId: p.photo_id,
    ...signFileUrl(p.storage_key),
    takenAt: p.uploaded_at,
    alt: photoAlt(alt?.defect ?? null, alt?.location ?? null, p.uploaded_at),
  }));
}

/** 건 요약 (C6) — 분석 요청·결과·기록·위험 통지 */
export async function caseSummary(caseId: number, db: Db = getPool()) {
  const c = await queryOne<{
    case_id: number;
    case_no: string;
    owner_id: number;
    building_id: number | null;
    created_at: string;
    building_name: string | null;
    building_type_name: string | null;
  }>(
    `SELECT c.case_id, c.case_no, c.owner_id, c.building_id, c.created_at, b.building_name, t.building_type_name
       FROM defect_case c LEFT JOIN building b ON b.building_id = c.building_id
       LEFT JOIN building_type_code t ON t.building_type_code = b.building_type_code
      WHERE c.case_id = ?`,
    [caseId],
    db,
  );
  if (!c) return null;
  const reqs = await query<{
    request_id: number;
    description: string | null;
    req_status: string;
    quality_reject_reason: string | null;
    requested_at: string;
  }>(
    'SELECT request_id, description, req_status, quality_reject_reason, requested_at FROM analysis_request WHERE case_id = ? ORDER BY request_id',
    [caseId],
    db,
  );
  const latestResult = await queryOne<{ result_id: number; request_id: number }>(
    `SELECT ar.result_id, ar.request_id FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id
      WHERE q.case_id = ? ORDER BY ar.result_id DESC LIMIT 1`,
    [caseId],
    db,
  );
  const records = await query<{
    record_id: number;
    location_text: string | null;
    defect_type_code: string | null;
    defect_type_name: string | null;
    repair_status: string | null;
    ai_match: string | null;
    record_status: string;
    saved_at: string | null;
    inspection_note: string | null;
  }>(
    `SELECT r.record_id, r.location_text, r.defect_type_code, d.defect_type_name, r.repair_status, r.ai_match, r.record_status, r.saved_at, r.inspection_note
       FROM inspection_record r LEFT JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code
      WHERE r.case_id = ? ORDER BY r.record_id`,
    [caseId],
    db,
  );
  const risks = await query<{
    risk_notice_id: number;
    source_kind: string;
    created_at: string;
    closed_at: string | null;
    close_reason: string | null;
  }>(
    'SELECT risk_notice_id, source_kind, created_at, closed_at, close_reason FROM risk_notice WHERE case_id = ? ORDER BY risk_notice_id',
    [caseId],
    db,
  );
  const result = latestResult ? await resultDto(latestResult.result_id, db) : null;
  const firstRecord = records.find((r) => r.record_status === 'saved') ?? records[0];
  const photos = latestResult
    ? await analysisPhotos(latestResult.request_id, db, { defect: firstRecord?.defect_type_name, location: firstRecord?.location_text })
    : reqs.length
      ? await analysisPhotos(reqs[reqs.length - 1].request_id, db)
      : [];
  return {
    caseId: c.case_id,
    caseNo: c.case_no,
    ownerId: c.owner_id,
    building: c.building_id ? { buildingId: c.building_id, buildingName: c.building_name, buildingTypeName: c.building_type_name } : null,
    createdAt: c.created_at,
    description: reqs.length ? reqs[reqs.length - 1].description : null,
    requests: reqs.map((r) => ({
      requestId: r.request_id,
      status: r.req_status,
      qualityRejectReason: r.quality_reject_reason,
      requestedAt: r.requested_at,
    })),
    result,
    photos,
    records: records.map((r) => ({
      recordId: r.record_id,
      locationText: r.location_text,
      defectTypeCode: r.defect_type_code,
      defectTypeName: r.defect_type_name,
      repairStatus: r.repair_status,
      aiMatch: r.ai_match,
      recordStatus: r.record_status,
      savedAt: r.saved_at,
      inspectionNote: r.inspection_note,
    })),
    riskNotices: risks.map((n) => ({
      riskNoticeId: n.risk_notice_id,
      sourceKind: n.source_kind,
      createdAt: n.created_at,
      closedAt: n.closed_at,
      closeReason: n.close_reason,
      open: !n.closed_at,
    })),
  };
}
