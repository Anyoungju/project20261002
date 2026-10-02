import { exec, query, queryOne, withTransaction, Db } from '../../db/pool';
import { createCase, resultDto, recordPhotos, analysisPhotos, caseProgress } from '../case/caseService';
import { storage, newStorageKey } from '../../adapters/storage';
import { gateError, releaseGates } from '../../gates/gateBlock';
import { HttpError, notFound, conflict } from '../../lib/http';
import { notify } from '../notification/notificationService';
import { buildingInfo } from '../building/buildingService';

export interface RecordFields {
  locationText?: string | null;
  defectTypeCode?: string | null;
  repairStatus?: 'completed' | 'pending' | null;
  repairMethod?: string | null;
  inspectionNote?: string | null;
  aiMatch?: 'match' | 'mismatch' | 'none' | null;
  riskFlag?: boolean;
}

/** 연결 가능한 분석 결과: 내 결과(비회원 미연결 결과 제외 — FR-120b) 또는 이 건물 건의 결과, 아직 저장 기록에 연결되지 않은 것 */
export async function linkableResults(userId: number, buildingId: number) {
  const rows = await query<{
    result_id: number;
    case_id: number;
    case_no: string;
    risk_level: string;
    completed_at: string;
    top_cause: string | null;
    request_id: number;
  }>(
    `SELECT ar.result_id, c.case_id, c.case_no, ar.risk_level, ar.completed_at, ar.request_id,
            (SELECT cause_text FROM analysis_cause WHERE result_id = ar.result_id AND cause_rank = 1) AS top_cause
       FROM analysis_result ar
       JOIN analysis_request q ON q.request_id = ar.request_id
       JOIN defect_case c ON c.case_id = q.case_id
       JOIN user_account u ON u.user_id = c.owner_id
      WHERE u.is_guest = FALSE
        AND ((c.owner_id = ? AND (c.building_id IS NULL OR c.building_id = ?)) OR c.building_id = ?)
        AND NOT EXISTS (SELECT 1 FROM inspection_record r WHERE r.result_id = ar.result_id AND r.record_status = 'saved')
      ORDER BY ar.completed_at DESC LIMIT 30`,
    [userId, buildingId, buildingId],
  );
  return rows.map((r) => ({
    resultId: r.result_id,
    caseId: r.case_id,
    caseNo: r.case_no,
    riskLevel: r.risk_level,
    completedAt: r.completed_at,
    topCause: r.top_cause,
  }));
}

export async function createDraft(userId: number, buildingId: number, resultId: number | null) {
  return withTransaction(async (conn) => {
    let caseId: number;
    if (resultId) {
      const r = await queryOne<{ case_id: number; owner_id: number; building_id: number | null; is_guest: number }>(
        `SELECT c.case_id, c.owner_id, c.building_id, u.is_guest FROM analysis_result ar
           JOIN analysis_request q ON q.request_id = ar.request_id JOIN defect_case c ON c.case_id = q.case_id
           JOIN user_account u ON u.user_id = c.owner_id WHERE ar.result_id = ? FOR UPDATE`,
        [resultId],
        conn,
      );
      if (!r) throw notFound('분석 결과를 찾을 수 없습니다');
      if (r.is_guest) throw new HttpError(409, 'guest_result', '계정에 연결되지 않은 비회원 분석 결과는 현장 기록에 연결할 수 없습니다');
      if (r.building_id && r.building_id !== buildingId) throw conflict('다른 건물의 분석 결과입니다', 'other_building');
      if (!r.building_id) {
        if (r.owner_id !== userId) throw new HttpError(403, 'forbidden_result', '이 분석 결과를 연결할 수 없습니다');
        await exec('UPDATE defect_case SET building_id = ? WHERE case_id = ?', [buildingId, r.case_id], conn);
      }
      caseId = r.case_id;
    } else {
      caseId = (await createCase(conn, userId, buildingId)).caseId;
    }
    const ins = await exec(
      'INSERT INTO inspection_record (case_id, building_id, recorder_id, result_id) VALUES (?, ?, ?, ?)',
      [caseId, buildingId, userId, resultId],
      conn,
    );
    return ins.insertId;
  });
}

async function loadRecord(recordId: number, db?: Db) {
  return queryOne<{
    record_id: number;
    case_id: number;
    building_id: number;
    recorder_id: number;
    result_id: number | null;
    location_text: string | null;
    defect_type_code: string | null;
    repair_status: string | null;
    repair_method: string | null;
    inspection_note: string | null;
    ai_match: string | null;
    record_status: 'draft' | 'saved';
    created_at: string;
    saved_at: string | null;
  }>('SELECT * FROM inspection_record WHERE record_id = ?', [recordId], db);
}

export async function recordBuildingId(recordId: number): Promise<number | null> {
  return (await loadRecord(recordId))?.building_id ?? null;
}

export async function recordDto(recordId: number) {
  const r = await loadRecord(recordId);
  if (!r) return null;
  const c = await queryOne<{ case_no: string }>('SELECT case_no FROM defect_case WHERE case_id = ?', [r.case_id]);
  const dname = r.defect_type_code
    ? (
        await queryOne<{ defect_type_name: string }>('SELECT defect_type_name FROM defect_type_code WHERE defect_type_code = ?', [
          r.defect_type_code,
        ])
      )?.defect_type_name
    : null;
  const risk = await queryOne<{ risk_flag: number }>('SELECT risk_flag FROM inspection_record_risk WHERE record_id = ?', [recordId]);
  const item = await queryOne<{ item_id: number; item_status: string }>(
    'SELECT item_id, item_status FROM verification_item WHERE record_id = ?',
    [recordId],
  );
  const dataRequests = item
    ? await query<{ data_req_id: number; reason: string; sent_at: string | null; resolved_at: string | null }>(
        'SELECT data_req_id, reason, sent_at, resolved_at FROM data_request WHERE item_id = ? ORDER BY data_req_id DESC',
        [item.item_id],
      )
    : [];
  const log = await query<{ old_status: string; new_status: string; changed_at: string }>(
    'SELECT old_status, new_status, changed_at FROM record_repair_log WHERE record_id = ? ORDER BY log_id',
    [recordId],
  );
  const schedule = await queryOne<{ schedule_id: number; item_text: string }>(
    'SELECT schedule_id, item_text FROM inspection_schedule WHERE completed_record_id = ?',
    [recordId],
  );
  let prefill = null;
  if (r.result_id) {
    const result = await resultDto(r.result_id);
    prefill = { result, photos: await analysisPhotos(result.requestId, undefined, { defect: dname, location: r.location_text }) };
  }
  return {
    recordId: r.record_id,
    caseId: r.case_id,
    caseNo: c?.case_no,
    building: await buildingInfo(r.building_id),
    recorderId: r.recorder_id,
    resultId: r.result_id,
    fields: {
      locationText: r.location_text,
      defectTypeCode: r.defect_type_code,
      defectTypeName: dname,
      repairStatus: r.repair_status,
      repairMethod: r.repair_method,
      inspectionNote: r.inspection_note,
      aiMatch: r.ai_match,
      riskFlag: !!risk?.risk_flag,
    },
    recordStatus: r.record_status,
    createdAt: r.created_at,
    savedAt: r.saved_at,
    photos: await recordPhotos(recordId, undefined, { defect: dname, location: r.location_text }),
    prefill,
    verification: item ? { itemId: item.item_id, status: item.item_status } : null,
    dataRequests: dataRequests.map((d) => ({
      dataReqId: d.data_req_id,
      reason: d.reason,
      sentAt: d.sent_at,
      resolvedAt: d.resolved_at,
      open: !d.resolved_at,
    })),
    repairLog: log.map((l) => ({ oldStatus: l.old_status, newStatus: l.new_status, changedAt: l.changed_at })),
    completedSchedule: schedule ? { scheduleId: schedule.schedule_id, itemText: schedule.item_text } : null,
    progress: await caseProgress(r.case_id),
  };
}

export async function patchDraft(recordId: number, userId: number, f: RecordFields) {
  const r = await loadRecord(recordId);
  if (!r) throw notFound('기록을 찾을 수 없습니다');
  if (r.recorder_id !== userId) throw new HttpError(403, 'not_recorder', '작성자만 수정할 수 있습니다');
  if (r.record_status === 'saved') {
    // 저장된 기록은 위험 표시만 갱신 가능(보수 결과는 별도 경로)
    if (f.riskFlag !== undefined) await setRisk(recordId, f.riskFlag);
    return;
  }
  const cols: string[] = [];
  const vals: unknown[] = [];
  const map: Array<[keyof RecordFields, string]> = [
    ['locationText', 'location_text'],
    ['defectTypeCode', 'defect_type_code'],
    ['repairStatus', 'repair_status'],
    ['repairMethod', 'repair_method'],
    ['inspectionNote', 'inspection_note'],
    ['aiMatch', 'ai_match'],
  ];
  for (const [k, col] of map) {
    if (f[k] !== undefined) {
      cols.push(`${col} = ?`);
      const v = f[k];
      vals.push(typeof v === 'string' ? v.trim() || null : v);
    }
  }
  // 연결 결과 없으면 비교 대상도 없다 (chk_rec_match_link)
  if (!r.result_id && f.aiMatch !== undefined && f.aiMatch !== 'none' && f.aiMatch !== null) {
    throw new HttpError(422, 'ai_match_without_result', '연결된 분석 결과가 없으면 AI 일치 여부는 "해당 없음"입니다');
  }
  if (cols.length) await exec(`UPDATE inspection_record SET ${cols.join(', ')} WHERE record_id = ?`, [...vals, recordId]);
  if (f.riskFlag !== undefined) await setRisk(recordId, f.riskFlag);
}

async function setRisk(recordId: number, flag: boolean) {
  if (flag) {
    await exec(
      'INSERT INTO inspection_record_risk (record_id, risk_flag) VALUES (?, TRUE) ON DUPLICATE KEY UPDATE risk_flag = TRUE, flagged_at = CURRENT_TIMESTAMP',
      [recordId],
    );
  } else {
    await exec('DELETE FROM inspection_record_risk WHERE record_id = ?', [recordId]);
  }
}

/** FR-035 — 사진 저장 실패는 draft 유지 + 재업로드 안내. 사진 추가 시 열린 자료 요청은 트리거가 해소 */
export async function addPhotos(recordId: number, userId: number, files: Array<{ buffer: Buffer; mimetype: string }>) {
  const r = await loadRecord(recordId);
  if (!r) throw notFound('기록을 찾을 수 없습니다');
  if (r.recorder_id !== userId) throw new HttpError(403, 'not_recorder', '작성자만 사진을 추가할 수 있습니다');
  if (!files.length) throw new HttpError(422, 'photo_required', '사진을 1장 이상 선택해 주세요');
  const openBefore = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM data_request d JOIN verification_item i ON i.item_id = d.item_id
      WHERE i.record_id = ? AND d.resolved_at IS NULL AND d.sent_at IS NOT NULL`,
    [recordId],
  );
  const saved: number[] = [];
  try {
    for (const f of files) {
      const key = newStorageKey('record', f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/webp' ? 'webp' : 'jpg');
      await storage.put(key, f.buffer);
      const ins = await exec('INSERT INTO record_photo (record_id, storage_key) VALUES (?, ?)', [recordId, key]);
      saved.push(ins.insertId);
    }
  } catch {
    throw new HttpError(
      503,
      'photo_store_failed',
      '사진을 저장하지 못했습니다 - 입력한 내용은 임시 저장되었습니다. 사진을 다시 올려 주세요',
      {
        savedPhotoIds: saved,
      },
    );
  }
  // 자료 요청 해소 → 요청한 전문가에게 알림
  if (Number(openBefore?.n ?? 0) > 0) {
    const experts = await query<{ expert_id: number; item_id: number }>(
      `SELECT DISTINCT d.expert_id, d.item_id FROM data_request d JOIN verification_item i ON i.item_id = d.item_id
        WHERE i.record_id = ? AND d.resolved_at IS NOT NULL AND d.resolved_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE)`,
      [recordId],
    );
    for (const e of experts) {
      await notify(
        e.expert_id,
        'data_resolved',
        { kind: 'verification_item', id: e.item_id },
        '요청한 추가 자료가 도착해 검증 대기로 돌아왔습니다',
        `/verification?itemId=${e.item_id}`,
      );
      await releaseGates({ kind: 'verification_item', id: e.item_id }, 'G6', userId, 'photo-added');
    }
  }
  return saved;
}

/** G5 — 앱 사전 검증으로 누락 목록을 만든다(최종 강제는 CHECK·트리거) */
export async function saveRecord(recordId: number, userId: number) {
  const r = await loadRecord(recordId);
  if (!r) throw notFound('기록을 찾을 수 없습니다');
  if (r.recorder_id !== userId) throw new HttpError(403, 'not_recorder', '작성자만 저장할 수 있습니다');
  if (r.record_status === 'saved') return;
  const photos = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM record_photo WHERE record_id = ?', [recordId]);
  const missing: string[] = [];
  if (!r.location_text) missing.push('location');
  if (!r.defect_type_code) missing.push('defectType');
  if (!r.repair_status) missing.push('repairStatus');
  if (r.result_id && !r.ai_match) missing.push('aiMatch');
  if (!Number(photos?.n)) missing.push('photo');
  if (missing.length) {
    const label: Record<string, string> = {
      location: '위치',
      defectType: '하자 종류',
      repairStatus: '보수 결과',
      aiMatch: 'AI 일치 여부',
      photo: '현장 사진',
    };
    throw await gateError('G5', {
      reason: `누락: ${missing.map((m) => label[m]).join(' · ')}`,
      missingFields: missing,
      actorId: userId,
      subject: { kind: 'inspection_record', id: recordId },
      actions: [{ id: 'goto-missing', label: '누락 항목으로 이동' }],
    });
  }
  await withTransaction(async (conn) => {
    if (!r.result_id && r.ai_match !== 'none')
      await exec("UPDATE inspection_record SET ai_match = 'none' WHERE record_id = ?", [recordId], conn);
    await exec("UPDATE inspection_record SET record_status = 'saved' WHERE record_id = ? AND record_status = 'draft'", [recordId], conn);
    await releaseGates({ kind: 'inspection_record', id: recordId }, 'G5', userId, 'saved', conn);
  });
}

/** FR-034 — 저장 후 보수 결과는 pending → completed 만 */
export async function updateRepairStatus(recordId: number, userId: number, status: 'completed' | 'pending', method?: string | null) {
  const r = await loadRecord(recordId);
  if (!r) throw notFound('기록을 찾을 수 없습니다');
  if (r.record_status !== 'saved') throw conflict('저장된 기록만 보수 결과를 갱신할 수 있습니다', 'not_saved');
  if (r.repair_status === status) return;
  if (!(r.repair_status === 'pending' && status === 'completed'))
    throw conflict('보수 결과는 미완료에서 완료로만 바꿀 수 있습니다', 'repair_transition');
  await withTransaction(async (conn) => {
    await exec(
      'UPDATE inspection_record SET repair_status = ?, repair_method = COALESCE(?, repair_method) WHERE record_id = ?',
      [status, method ?? null, recordId],
      conn,
    );
    await exec(
      'INSERT INTO record_repair_log (record_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
      [recordId, r.repair_status, status, userId],
      conn,
    );
  });
}

export async function myRecords(userId: number, status?: 'draft' | 'saved') {
  const rows = await query<{
    record_id: number;
    case_no: string;
    building_name: string;
    location_text: string | null;
    defect_type_name: string | null;
    record_status: string;
    repair_status: string | null;
    created_at: string;
    saved_at: string | null;
    open_requests: number;
  }>(
    `SELECT r.record_id, c.case_no, b.building_name, r.location_text, d.defect_type_name, r.record_status, r.repair_status, r.created_at, r.saved_at,
            (SELECT COUNT(*) FROM data_request dr JOIN verification_item i ON i.item_id = dr.item_id
              WHERE i.record_id = r.record_id AND dr.resolved_at IS NULL AND dr.sent_at IS NOT NULL) AS open_requests
       FROM inspection_record r JOIN defect_case c ON c.case_id = r.case_id JOIN building b ON b.building_id = r.building_id
       LEFT JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code
      WHERE r.recorder_id = ? ${status ? 'AND r.record_status = ?' : ''}
      ORDER BY r.record_id DESC LIMIT 50`,
    status ? [userId, status] : [userId],
  );
  return rows.map((r) => ({
    recordId: r.record_id,
    caseNo: r.case_no,
    buildingName: r.building_name,
    locationText: r.location_text,
    defectTypeName: r.defect_type_name,
    recordStatus: r.record_status,
    repairStatus: r.repair_status,
    createdAt: r.created_at,
    savedAt: r.saved_at,
    openDataRequests: Number(r.open_requests),
  }));
}
