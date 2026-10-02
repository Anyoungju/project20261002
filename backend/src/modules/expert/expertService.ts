import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { buildBlock, gateError } from '../../gates/gateBlock';
import { currentNotice, noticeById } from '../reference/referenceRouter';
import { caseSummary, caseProgress } from '../case/caseService';
import { maskedUsers } from '../../lib/mask';
import { notify } from '../notification/notificationService';
import { HttpError, notFound, conflict } from '../../lib/http';
import { hasBuildingAccess } from '../../middleware/authorize';

const SPECIALTY: Record<string, string> = { architecture: '건축', structure: '구조', waterproof: '방수' };
const SOURCE_TO_ORIGIN: Record<string, string> = { analysis: 'analysis', verdict: 'verdict', inspection: 'inspection' };

async function constNum(key: string): Promise<number | null> {
  const r = await queryOne<{ const_value: string | null }>('SELECT const_value FROM service_constant WHERE const_key = ?', [key]);
  if (r?.const_value == null) return null;
  const n = Number(r.const_value);
  return Number.isFinite(n) ? n : null;
}

/** BR-DEF-09 — 수수료 = 요율 × 기준, 둘 중 하나라도 미설정이면 NULL(기록 안 함) */
export async function feeInfo() {
  const rate = await constNum('expert_fee_rate');
  const base = await constNum('expert_fee_base');
  const amount = rate != null && base != null ? Math.round(rate * base) : null;
  return {
    rate,
    base,
    amount,
    text:
      amount != null
        ? `연결 확정 시 ${amount.toLocaleString('ko-KR')}원이 부과됩니다(요율 ${rate} × 기준 ${base!.toLocaleString('ko-KR')}원). 거절·무응답에는 부과되지 않습니다.`
        : '연결 수수료 요율이 아직 정해지지 않아 이번 연결에는 수수료가 기록되지 않습니다. 거절·무응답에는 부과되지 않습니다.',
  };
}

// ------------------------------------------------------------------ 위험 통지
/** 건물관리자: manage 권한 건물의 열린 위험 통지 */
export async function listRiskNotices(userId: number, includeClosed = false) {
  const rows = await query(
    `SELECT n.risk_notice_id, n.case_id, c.case_no, n.source_kind, n.created_at, n.closed_at, n.close_reason, c.building_id, b.building_name,
            (SELECT ar.risk_level FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id = c.case_id ORDER BY ar.result_id DESC LIMIT 1) AS risk_level,
            (SELECT ac.cause_text FROM analysis_cause ac JOIN analysis_result ar ON ar.result_id = ac.result_id JOIN analysis_request q ON q.request_id = ar.request_id
              WHERE q.case_id = c.case_id AND ac.cause_rank = 1 ORDER BY ar.result_id DESC LIMIT 1) AS top_cause,
            (SELECT x.exp_req_id FROM expert_request x WHERE x.risk_notice_id = n.risk_notice_id ORDER BY x.exp_req_id DESC LIMIT 1) AS exp_req_id
       FROM risk_notice n JOIN defect_case c ON c.case_id = n.case_id JOIN building b ON b.building_id = c.building_id
      WHERE c.building_id IN (SELECT building_id FROM v_access_check WHERE user_id = ? AND access_kind = 'manage')
        ${includeClosed ? '' : 'AND n.closed_at IS NULL'}
      ORDER BY n.closed_at IS NULL DESC, n.created_at DESC LIMIT 100`,
    [userId],
  );
  const label: Record<string, string> = { analysis: 'AI 분석 위험 권고', verdict: '전문가 위험 판정', inspection: '정기점검 결과 위험' };
  return rows.map((r) => ({
    riskNoticeId: r.risk_notice_id,
    caseId: r.case_id,
    caseNo: r.case_no,
    buildingId: r.building_id,
    buildingName: r.building_name,
    sourceKind: r.source_kind,
    sourceLabel: label[r.source_kind] ?? r.source_kind,
    riskLevel: r.risk_level,
    topCause: r.top_cause,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    closeReason: r.close_reason,
    open: !r.closed_at,
    expReqId: r.exp_req_id,
  }));
}

async function noticeBuilding(riskNoticeId: number) {
  return queryOne<{ case_id: number; building_id: number | null; closed_at: string | null; source_kind: string }>(
    'SELECT n.case_id, c.building_id, n.closed_at, n.source_kind FROM risk_notice n JOIN defect_case c ON c.case_id = n.case_id WHERE n.risk_notice_id = ?',
    [riskNoticeId],
  );
}

export async function dismissRiskNotice(userId: number, riskNoticeId: number) {
  const n = await noticeBuilding(riskNoticeId);
  if (!n) throw notFound('위험 통지를 찾을 수 없습니다');
  if (!n.building_id || !(await hasBuildingAccess(userId, n.building_id, 'manage')))
    throw new HttpError(403, 'forbidden', '이 위험 통지를 처리할 권한이 없습니다');
  if (n.closed_at) return;
  await exec(
    "UPDATE risk_notice SET closed_at = CURRENT_TIMESTAMP, close_reason = 'dismissed' WHERE risk_notice_id = ? AND closed_at IS NULL",
    [riskNoticeId],
  );
}

// ------------------------------------------------------------------ 요청
export async function createRequest(
  userId: number,
  b: { caseId: number; riskNoticeId?: number | null; originKind?: string; specialtyCode: string; wishFrom: string; wishTo: string },
) {
  const c = await queryOne<{ building_id: number | null }>('SELECT building_id FROM defect_case WHERE case_id = ?', [b.caseId]);
  if (!c) throw notFound('하자 건을 찾을 수 없습니다');
  // FR-121 — 건물관리자만, 건물이 있는 건만
  if (!c.building_id) throw new HttpError(409, 'no_building', '건물에 연결되지 않은 하자 건은 전문가 연결을 요청할 수 없습니다');
  if (!(await hasBuildingAccess(userId, c.building_id, 'manage'))) throw new HttpError(403, 'forbidden', '이 건물의 관리 권한이 없습니다');
  let riskNoticeId = b.riskNoticeId ?? null;
  if (!riskNoticeId) {
    const open = await queryOne<{ risk_notice_id: number }>(
      'SELECT risk_notice_id FROM risk_notice WHERE case_id = ? AND closed_at IS NULL ORDER BY risk_notice_id DESC LIMIT 1',
      [b.caseId],
    );
    riskNoticeId = open?.risk_notice_id ?? null;
  }
  let origin = b.originKind ?? 'direct';
  if (riskNoticeId) {
    const n = await noticeBuilding(riskNoticeId);
    if (!n || n.case_id !== b.caseId) throw new HttpError(422, 'notice_mismatch', '위험 통지가 이 하자 건의 것이 아닙니다');
    if (!b.originKind || ['analysis', 'verdict', 'inspection'].includes(origin)) origin = SOURCE_TO_ORIGIN[n.source_kind] ?? origin;
  }
  if (b.wishFrom > b.wishTo) throw new HttpError(422, 'wish_range', '희망 시작일이 종료일보다 늦습니다');
  const r = await exec(
    'INSERT INTO expert_request (case_id, building_id, requester_id, origin_kind, risk_notice_id, specialty_code, wish_from, wish_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [b.caseId, c.building_id, userId, origin, riskNoticeId, b.specialtyCode, b.wishFrom, b.wishTo],
  );
  return r.insertId;
}

async function loadRequest(id: number) {
  return queryOne<{
    exp_req_id: number;
    case_id: number;
    building_id: number;
    requester_id: number;
    origin_kind: string;
    risk_notice_id: number | null;
    specialty_code: string;
    wish_from: string;
    wish_to: string;
    created_at: string;
    closed_at: string | null;
  }>('SELECT * FROM expert_request WHERE exp_req_id = ?', [id]);
}

export async function requestBuildingId(id: number) {
  return (await loadRequest(id))?.building_id ?? null;
}

/** 조건 바꾸기 (G8 해제 행동) — 진행 중 시도가 없을 때만 */
export async function updateConditions(id: number, b: { specialtyCode?: string; wishFrom?: string; wishTo?: string }) {
  const r = await loadRequest(id);
  if (!r) throw notFound('요청을 찾을 수 없습니다');
  const st = await queryOne<{ request_status: string }>('SELECT request_status FROM v_expert_request_status WHERE exp_req_id = ?', [id]);
  if (st && ['awaiting', 'connected', 'closed'].includes(st.request_status))
    throw conflict('응답 대기·확정된 요청은 조건을 바꿀 수 없습니다', 'request_locked');
  const from = b.wishFrom ?? r.wish_from;
  const to = b.wishTo ?? r.wish_to;
  if (from > to) throw new HttpError(422, 'wish_range', '희망 시작일이 종료일보다 늦습니다');
  await exec('UPDATE expert_request SET specialty_code = ?, wish_from = ?, wish_to = ? WHERE exp_req_id = ?', [
    b.specialtyCode ?? r.specialty_code,
    from,
    to,
    id,
  ]);
}

/** FR-081 · G8 — 분야 + 희망 기간 내 가능일. 이미 시도한 전문가 제외. 마스킹 */
export async function candidates(id: number) {
  const r = await loadRequest(id);
  if (!r) throw notFound('요청을 찾을 수 없습니다');
  const rows = await query<{ expert_id: number; days: string }>(
    `SELECT s.expert_id, GROUP_CONCAT(DISTINCT a.available_on ORDER BY a.available_on) AS days
       FROM expert_specialty s JOIN expert_availability a ON a.expert_id = s.expert_id
      WHERE s.specialty_code = ? AND a.available_on BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM expert_request_attempt t WHERE t.exp_req_id = ? AND t.expert_id = s.expert_id)
      GROUP BY s.expert_id ORDER BY MIN(a.available_on)`,
    [r.specialty_code, r.wish_from, r.wish_to, id],
  );
  const people = await maskedUsers(rows.map((x) => x.expert_id));
  const specs = rows.length
    ? await query<{ expert_id: number; specialty_code: string }>(
        'SELECT expert_id, specialty_code FROM expert_specialty WHERE expert_id IN (?)',
        [rows.map((x) => x.expert_id)],
      )
    : [];
  const list = rows.map((x) => ({
    expertId: x.expert_id,
    expert: people.get(x.expert_id) ?? null,
    specialties: specs.filter((s) => s.expert_id === x.expert_id).map((s) => SPECIALTY[s.specialty_code] ?? s.specialty_code),
    availableDays: String(x.days).split(','),
  }));
  // 같은 요청의 열린 G8 이벤트가 있으면 다시 기록하지 않는다(조회마다 쌓이지 않게)
  const openG8 = list.length
    ? null
    : await queryOne(
        "SELECT 1 AS x FROM gate_event WHERE gate_code = 'G8' AND subject_kind = 'expert_request' AND subject_id = ? AND released_at IS NULL",
        [id],
      );
  const gate = list.length
    ? null
    : await buildBlock('G8', {
        record: !openG8,
        reason: `${SPECIALTY[r.specialty_code]} 분야 · ${r.wish_from} ~ ${r.wish_to} 에 가능한 전문가가 없습니다`,
        subject: { kind: 'expert_request', id },
        actions: [{ id: 'change-conditions', label: '조건 바꾸기' }],
      });
  return { candidates: list, gate };
}

function scopeTextFor(caseNo: string) {
  return `하자 건 ${caseNo}의 사진, 사용자 설명, AI 분석 결과(원인·대응방안·위험도), 현장 점검 기록(위치·하자 종류·보수 결과), 건물명·건물 유형. 연락처는 연결이 확정된 뒤에만 양측에 공개됩니다.`;
}

/** FR-082 — 수수료·공유 범위·고지 판본을 확정 버튼보다 먼저 */
export async function preview(id: number, expertId: number) {
  const r = await loadRequest(id);
  if (!r) throw notFound('요청을 찾을 수 없습니다');
  const c = await queryOne<{ case_no: string }>('SELECT case_no FROM defect_case WHERE case_id = ?', [r.case_id]);
  const ex = await maskedUsers([expertId]);
  return {
    expReqId: id,
    expert: ex.get(expertId) ?? null,
    fee: await feeInfo(),
    scopeText: scopeTextFor(c!.case_no),
    notice: await currentNotice('share'),
  };
}

/** G9 — 동의 없으면 차단·아무것도 전달 안 함. 동의 + 시도는 한 트랜잭션 (FR-083 전문가 1명) */
export async function confirm(id: number, userId: number, b: { expertId: number; consent: boolean; scopeText: string; noticeId: number }) {
  const r = await loadRequest(id);
  if (!r) throw notFound('요청을 찾을 수 없습니다');
  if (!b.consent) {
    throw await gateError('G9', {
      reason: '공유 범위 동의 체크가 필요합니다 - 동의 전에는 어떤 자료도 전문가에게 전달되지 않습니다',
      actorId: userId,
      subject: { kind: 'expert_request', id },
      actions: [{ id: 'consent', label: '공유 범위 확인하고 동의하기' }],
    });
  }
  const st = await queryOne<{ request_status: string }>('SELECT request_status FROM v_expert_request_status WHERE exp_req_id = ?', [id]);
  if (st?.request_status === 'awaiting') throw conflict('이미 응답을 기다리는 요청이 있습니다', 'awaiting');
  if (st?.request_status === 'connected' || st?.request_status === 'closed')
    throw conflict('이미 확정·종료된 요청입니다', 'request_closed');
  const { candidates: list } = await candidates(id);
  if (!list.some((x) => x.expertId === b.expertId)) {
    throw await gateError('G8', {
      reason: '선택한 전문가가 조건에 맞지 않습니다',
      subject: { kind: 'expert_request', id },
      actions: [{ id: 'change-conditions', label: '조건 바꾸기' }],
    });
  }
  const c = await queryOne<{ case_no: string }>('SELECT case_no FROM defect_case WHERE case_id = ?', [r.case_id]);
  const scope = scopeTextFor(c!.case_no);
  const notice = await currentNotice('share');
  if (b.noticeId !== notice.noticeId || b.scopeText !== scope) {
    throw new HttpError(409, 'notice_changed', '고지 문구나 공유 범위가 바뀌었습니다 - 다시 확인하고 동의해 주세요');
  }
  const attemptId = await withTransaction(async (conn) => {
    const con = await exec(
      "INSERT INTO share_consent (exp_req_id, expert_id, scope_text, notice_id, notice_kind, consented_by) VALUES (?, ?, ?, ?, 'share', ?)",
      [id, b.expertId, scope, notice.noticeId, userId],
      conn,
    );
    const t = await exec(
      'INSERT INTO expert_request_attempt (exp_req_id, expert_id, consent_id) VALUES (?, ?, ?)',
      [id, b.expertId, con.insertId],
      conn,
    );
    await exec(
      "UPDATE gate_event SET released_at = CURRENT_TIMESTAMP, released_by = ?, release_action = 'consented' WHERE subject_kind = 'expert_request' AND subject_id = ? AND gate_code IN ('G8','G9') AND released_at IS NULL",
      [userId, id],
      conn,
    );
    return t.insertId;
  });
  await notify(
    b.expertId,
    'expert_attempt',
    { kind: 'expert_request_attempt', id: attemptId },
    `새 점검 요청: ${c!.case_no} (${SPECIALTY[r.specialty_code]})`,
    `/expert-inbox?attemptId=${attemptId}`,
  );
  return attemptId;
}

export async function requestDetail(id: number) {
  const r = await loadRequest(id);
  if (!r) return null;
  const st = await queryOne<{ request_status: string }>('SELECT request_status FROM v_expert_request_status WHERE exp_req_id = ?', [id]);
  const attempts = await query(
    `SELECT t.attempt_id, t.expert_id, t.sent_at, t.response, t.responded_at, t.decline_reason, s.scope_text, s.consented_at, s.notice_id,
            ec.connection_id, ec.fee_amount, ec.confirmed_at
       FROM expert_request_attempt t JOIN share_consent s ON s.consent_id = t.consent_id
       LEFT JOIN expert_connection ec ON ec.attempt_id = t.attempt_id
      WHERE t.exp_req_id = ? ORDER BY t.attempt_id`,
    [id],
  );
  const people = await maskedUsers(attempts.map((a) => a.expert_id));
  const status = st?.request_status ?? 'drafting';
  const conn = attempts.find((a) => a.connection_id);
  let contact = null;
  if (conn) {
    const ex = await queryOne<{ email: string; phone: string | null; display_name: string }>(
      'SELECT email, phone, display_name FROM user_account WHERE user_id = ?',
      [conn.expert_id],
    );
    contact = ex ? { name: ex.display_name, email: ex.email, phone: ex.phone } : null; // 연결 확정 후에만 공개(스펙 Assumptions)
  }
  let gate = null;
  if (status === 'awaiting') gate = await buildBlock('G10', { record: false, reason: '전문가의 수락을 기다리고 있습니다', actions: [] });
  if (status === 'not_confirmed') {
    const last = attempts[attempts.length - 1];
    gate = await buildBlock('G10', {
      record: false,
      reason:
        last?.response === 'no_response'
          ? '응답 시한 안에 응답이 없었습니다 - 수수료는 발생하지 않았습니다'
          : `전문가가 거절했습니다${last?.decline_reason ? ` - ${last.decline_reason}` : ''} - 수수료는 발생하지 않았습니다`,
      actions: [{ id: 'other-candidate', label: '다른 후보에게 요청 보내기' }],
    });
  }
  return {
    expReqId: r.exp_req_id,
    caseId: r.case_id,
    buildingId: r.building_id,
    originKind: r.origin_kind,
    riskNoticeId: r.risk_notice_id,
    specialtyCode: r.specialty_code,
    specialtyName: SPECIALTY[r.specialty_code],
    wishFrom: r.wish_from,
    wishTo: r.wish_to,
    status,
    createdAt: r.created_at,
    gate,
    case: await caseSummary(r.case_id),
    progress: await caseProgress(r.case_id),
    attempts: attempts.map((a) => ({
      attemptId: a.attempt_id,
      expert: people.get(a.expert_id) ?? null,
      sentAt: a.sent_at,
      response: a.response,
      respondedAt: a.responded_at,
      declineReason: a.decline_reason,
      scopeText: a.scope_text,
      consentedAt: a.consented_at,
      connection: a.connection_id
        ? { connectionId: a.connection_id, feeAmount: a.fee_amount == null ? null : Number(a.fee_amount), confirmedAt: a.confirmed_at }
        : null,
    })),
    contact,
  };
}

export async function myRequests(userId: number) {
  const rows = await query(
    `SELECT er.exp_req_id, er.case_id, c.case_no, b.building_name, er.specialty_code, er.created_at, s.request_status
       FROM expert_request er JOIN v_expert_request_status s ON s.exp_req_id = er.exp_req_id
       JOIN defect_case c ON c.case_id = er.case_id JOIN building b ON b.building_id = er.building_id
      WHERE er.building_id IN (SELECT building_id FROM v_access_check WHERE user_id = ? AND access_kind = 'manage')
      ORDER BY er.exp_req_id DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    expReqId: r.exp_req_id,
    caseId: r.case_id,
    caseNo: r.case_no,
    buildingName: r.building_name,
    specialtyName: SPECIALTY[r.specialty_code],
    status: r.request_status,
    createdAt: r.created_at,
  }));
}

// ------------------------------------------------------------------ 전문가 측 (S8B)
export async function expertInbox(expertId: number) {
  const hours = await constNum('expert_response_hours');
  const rows = await query(
    `SELECT t.attempt_id, t.exp_req_id, t.sent_at, t.response, t.responded_at, c.case_no, er.specialty_code, er.wish_from, er.wish_to, b.building_name,
            (SELECT ec.connection_id FROM expert_connection ec WHERE ec.attempt_id = t.attempt_id) AS connection_id
       FROM expert_request_attempt t JOIN expert_request er ON er.exp_req_id = t.exp_req_id
       JOIN defect_case c ON c.case_id = er.case_id JOIN building b ON b.building_id = er.building_id
      WHERE t.expert_id = ? ORDER BY t.response IS NULL DESC, t.sent_at DESC LIMIT 100`,
    [expertId],
  );
  return rows.map((r) => ({
    attemptId: r.attempt_id,
    expReqId: r.exp_req_id,
    caseNo: r.case_no,
    buildingName: r.building_name,
    specialtyName: SPECIALTY[r.specialty_code],
    wishFrom: r.wish_from,
    wishTo: r.wish_to,
    sentAt: r.sent_at,
    respondBy:
      hours != null ? new Date(new Date(String(r.sent_at).replace(' ', 'T') + '+09:00').getTime() + hours * 3600_000).toISOString() : null,
    response: r.response,
    respondedAt: r.responded_at,
    connected: !!r.connection_id,
  }));
}

/** FR-084 — 동의된 범위의 자료만 */
export async function attemptDetail(attemptId: number, expertId: number) {
  const t = await queryOne(
    `SELECT t.*, s.scope_text, s.notice_id, er.case_id, er.specialty_code, er.wish_from, er.wish_to, er.requester_id
       FROM expert_request_attempt t JOIN share_consent s ON s.consent_id = t.consent_id JOIN expert_request er ON er.exp_req_id = t.exp_req_id
      WHERE t.attempt_id = ?`,
    [attemptId],
  );
  if (!t || t.expert_id !== expertId) return null;
  const s = await caseSummary(t.case_id);
  const connection = await queryOne<{ connection_id: number; fee_amount: number | null; confirmed_at: string }>(
    'SELECT * FROM expert_connection WHERE attempt_id = ?',
    [attemptId],
  );
  let contact = null;
  if (connection) {
    const u = await queryOne<{ email: string; phone: string | null; display_name: string }>(
      'SELECT email, phone, display_name FROM user_account WHERE user_id = ?',
      [t.requester_id],
    );
    contact = u ? { name: u.display_name, email: u.email, phone: u.phone } : null;
  }
  const hours = await constNum('expert_response_hours');
  return {
    attemptId,
    expReqId: t.exp_req_id,
    specialtyName: SPECIALTY[t.specialty_code],
    wishFrom: t.wish_from,
    wishTo: t.wish_to,
    sentAt: t.sent_at,
    respondBy:
      hours != null ? new Date(new Date(String(t.sent_at).replace(' ', 'T') + '+09:00').getTime() + hours * 3600_000).toISOString() : null,
    response: t.response,
    respondedAt: t.responded_at,
    scopeText: t.scope_text,
    shareNotice: await noticeById(t.notice_id),
    // 동의 범위: 사진·설명·AI 결과·현장 기록·건물명/유형 — 소유자·요청자 개인정보 없음
    shared: s
      ? {
          caseNo: s.caseNo,
          building: s.building ? { buildingName: s.building.buildingName, buildingTypeName: s.building.buildingTypeName } : null,
          description: s.description,
          result: s.result,
          photos: s.photos,
          records: s.records
            .filter((r) => r.recordStatus === 'saved')
            .map((r) => ({
              locationText: r.locationText,
              defectTypeName: r.defectTypeName,
              repairStatus: r.repairStatus,
              savedAt: r.savedAt,
            })),
        }
      : null,
    connection: connection
      ? {
          connectionId: connection.connection_id,
          feeAmount: connection.fee_amount == null ? null : Number(connection.fee_amount),
          confirmedAt: connection.confirmed_at,
        }
      : null,
    contact,
  };
}

/** G10 — 수락만 연결·수수료. 연결 시 위험 통지는 트리거가 닫는다(FR-086) */
export async function respond(attemptId: number, expertId: number, response: 'accepted' | 'declined', declineReason?: string | null) {
  const t = await queryOne<{ attempt_id: number; expert_id: number; response: string | null; exp_req_id: number }>(
    'SELECT attempt_id, expert_id, response, exp_req_id FROM expert_request_attempt WHERE attempt_id = ?',
    [attemptId],
  );
  if (!t || t.expert_id !== expertId) throw notFound('요청을 찾을 수 없습니다');
  if (t.response) throw conflict('이미 응답한 요청입니다', 'already_responded');
  const r = await loadRequest(t.exp_req_id);
  const c = await queryOne<{ case_no: string }>('SELECT case_no FROM defect_case WHERE case_id = ?', [r!.case_id]);
  const fee = await feeInfo();
  await withTransaction(async (conn) => {
    const u = await exec(
      'UPDATE expert_request_attempt SET response = ?, responded_at = CURRENT_TIMESTAMP, decline_reason = ? WHERE attempt_id = ? AND response IS NULL',
      [response, response === 'declined' ? (declineReason?.slice(0, 200) ?? null) : null, attemptId],
      conn,
    );
    if (!u.affectedRows) throw conflict('이미 응답한 요청입니다', 'already_responded');
    if (response === 'accepted') {
      await exec('INSERT INTO expert_connection (attempt_id, fee_amount) VALUES (?, ?)', [attemptId, fee.amount], conn);
    }
  });
  if (response === 'declined') {
    await buildBlock('G10', {
      reason: declineReason ?? '전문가 거절',
      actorId: expertId,
      subject: { kind: 'expert_request_attempt', id: attemptId },
    });
  }
  await notify(
    r!.requester_id,
    response === 'accepted' ? 'expert_connected' : 'expert_declined',
    { kind: 'expert_request', id: t.exp_req_id },
    response === 'accepted'
      ? `전문가 연결 확정: ${c!.case_no}`
      : `전문가가 요청을 거절했습니다: ${c!.case_no} - 다른 후보에게 요청할 수 있습니다`,
    `/expert-requests/${t.exp_req_id}`,
  );
}

/** FR-087 — 응답 시한(설정된 경우만) 경과 시 무응답 */
export async function runNoResponse() {
  const hours = await constNum('expert_response_hours');
  if (hours == null) {
    console.log('[job:no-response] expert_response_hours 미설정 — 자동 판정 안 함');
    return { updated: 0 };
  }
  const rows = await query<{ attempt_id: number; exp_req_id: number; requester_id: number; case_no: string }>(
    `SELECT t.attempt_id, t.exp_req_id, er.requester_id, c.case_no FROM expert_request_attempt t
       JOIN expert_request er ON er.exp_req_id = t.exp_req_id JOIN defect_case c ON c.case_id = er.case_id
      WHERE t.response IS NULL AND t.sent_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? HOUR)`,
    [hours],
  );
  for (const r of rows) {
    const u = await exec(
      "UPDATE expert_request_attempt SET response = 'no_response', responded_at = CURRENT_TIMESTAMP WHERE attempt_id = ? AND response IS NULL",
      [r.attempt_id],
    );
    if (u.affectedRows) {
      await buildBlock('G10', { reason: '응답 시한 경과', subject: { kind: 'expert_request_attempt', id: r.attempt_id } });
      await notify(
        r.requester_id,
        'expert_no_response',
        { kind: 'expert_request', id: r.exp_req_id },
        `전문가 무응답: ${r.case_no} - 다른 후보에게 요청할 수 있습니다`,
        `/expert-requests/${r.exp_req_id}`,
      );
    }
  }
  console.log(`[job:no-response] ${rows.length}건`);
  return { updated: rows.length };
}
