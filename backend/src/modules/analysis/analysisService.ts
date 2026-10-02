import { exec, query, queryOne, withTransaction, Db, getPool } from '../../db/pool';
import { storage, newStorageKey } from '../../adapters/storage';
import { judgeQuality } from '../../adapters/photoQuality/sharpQuality';
import { aiAnalyzer, AiFailure, RiskLevel } from '../../adapters/ai';
import { buildBlock, gateError, releaseGates, GateBlock } from '../../gates/gateBlock';
import { currentNotice } from '../reference/referenceRouter';
import { createCase, resultDto, aiLowConfidence, analysisPhotos, caseProgress } from '../case/caseService';
import { notify } from '../notification/notificationService';
import { ensureFreeTrial } from '../auth/guestLinkService';
import { HttpError, unprocessable } from '../../lib/http';

export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface EntitlementStatus {
  isGuest: boolean;
  eligible: boolean;
  freeTrial: { total: number; used: number; remaining: number } | null;
  paid: Array<{
    entitlementId: number;
    kind: string;
    quotaTotal: number | null;
    used: number;
    remaining: number | null;
    validUntil: string | null;
    usable: boolean;
  }>;
}

/** G2 판정은 v_analysis_eligibility · v_entitlement_balance 만 (코드에서 재계산 금지) */
export async function entitlementStatus(userId: number, isGuest: boolean, db: Db = getPool()): Promise<EntitlementStatus> {
  const el = await queryOne<{ eligible: number }>('SELECT eligible FROM v_analysis_eligibility WHERE user_id = ?', [userId], db);
  const rows = await query<{
    entitlement_id: number;
    ent_kind: string;
    quota_total: number | null;
    used_count: number;
    remaining: number | null;
    is_usable: number;
    valid_until: string | null;
  }>(
    `SELECT b.entitlement_id, b.ent_kind, b.quota_total, b.used_count, b.remaining, b.is_usable, e.valid_until
       FROM v_entitlement_balance b JOIN entitlement e ON e.entitlement_id = b.entitlement_id
      WHERE b.user_id = ? ORDER BY b.entitlement_id`,
    [userId],
    db,
  );
  const trials = rows.filter((r) => r.ent_kind === 'free_trial');
  const freeTrial = trials.length
    ? {
        total: trials.reduce((s, r) => s + (r.quota_total ?? 0), 0),
        used: trials.reduce((s, r) => s + Number(r.used_count), 0),
        remaining: Math.max(
          0,
          trials.reduce((s, r) => s + (r.remaining ?? 0), 0),
        ),
      }
    : null;
  return {
    isGuest,
    eligible: !!el?.eligible,
    freeTrial,
    paid: rows
      .filter((r) => r.ent_kind !== 'free_trial')
      .map((r) => ({
        entitlementId: r.entitlement_id,
        kind: r.ent_kind,
        quotaTotal: r.quota_total,
        used: Number(r.used_count),
        remaining: r.remaining == null ? null : Math.max(0, r.remaining),
        validUntil: r.valid_until,
        usable: !!r.is_usable,
      })),
  };
}

function g2Actions(isGuest: boolean) {
  return isGuest
    ? [{ id: 'login-purchase', label: '로그인하고 이용권 구매', href: '/login?returnTo=/purchase' }]
    : [{ id: 'purchase', label: '이용권 구매', href: '/purchase?returnTo=/analysis' }];
}

async function g2Block(userId: number, isGuest: boolean, subject?: { kind: 'analysis_request' | 'user_account'; id: number }, db?: Db) {
  const st = await entitlementStatus(userId, isGuest, db);
  const reason = st.freeTrial
    ? st.paid.length
      ? '유효한 이용권이 없습니다 - 기간이 지났거나 모두 사용했습니다'
      : `무료 체험 ${st.freeTrial.total}회를 모두 사용했습니다`
    : '사용할 수 있는 분석 이용권이 없습니다';
  return gateError(
    'G2',
    { reason, actorId: userId, subject: subject ?? { kind: 'user_account', id: userId }, actions: g2Actions(isGuest) },
    db,
  );
}

/**
 * 분석 요청 접수 (FR-010~FR-017). 순서: G2 사전 확인 → 건·요청·사진 저장 → G3(AI 미호출) → analyzing(FOR UPDATE, R6) → 비동기 AI
 */
export async function submitAnalysis(params: {
  userId: number;
  isGuest: boolean;
  description: string | null;
  photos: UploadedPhoto[];
  caseId?: number | null;
  buildingId?: number | null;
}) {
  const { userId, isGuest } = params;
  if (!params.photos.length) throw unprocessable('하자 사진을 1장 이상 올려 주세요', 'photo_required');
  if (!isGuest) await ensureFreeTrial(userId);

  const st = await entitlementStatus(userId, isGuest);
  if (!st.eligible) throw await g2Block(userId, isGuest);

  // 사진 품질은 저장 전에 판정해 둔다(같은 버퍼)
  const verdicts = await Promise.all(params.photos.map((p) => judgeQuality(p.buffer)));

  const keys: string[] = [];
  for (const p of params.photos) {
    const ext = p.mimetype === 'image/png' ? 'png' : p.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = newStorageKey('analysis', ext);
    await storage.put(key, p.buffer);
    keys.push(key);
  }

  const { requestId, caseId } = await withTransaction(async (conn) => {
    let caseId = params.caseId ?? null;
    if (caseId) {
      const c = await queryOne<{ owner_id: number }>('SELECT owner_id FROM defect_case WHERE case_id = ?', [caseId], conn);
      if (!c || c.owner_id !== userId) throw new HttpError(403, 'forbidden_case', '이 하자 건에 사진을 추가할 수 없습니다');
    } else {
      caseId = (await createCase(conn, userId, params.buildingId ?? null)).caseId;
    }
    const r = await exec(
      'INSERT INTO analysis_request (case_id, requester_id, description) VALUES (?, ?, ?)',
      [caseId, userId, params.description],
      conn,
    );
    for (const [i, key] of keys.entries()) {
      await exec(
        'INSERT INTO analysis_photo (request_id, storage_key, taken_at) VALUES (?, ?, ?)',
        [r.insertId, key, verdicts[i].takenAt],
        conn,
      );
    }
    // 같은 건의 이전 요청에 걸린 G3·G4 는 다시 올림으로 해제
    const prev = await query<{ request_id: number }>(
      'SELECT request_id FROM analysis_request WHERE case_id = ? AND request_id <> ?',
      [caseId, r.insertId],
      conn,
    );
    for (const p of prev) await releaseGates({ kind: 'analysis_request', id: p.request_id }, ['G2', 'G3', 'G4'], userId, 're-upload', conn);
    return { requestId: r.insertId, caseId };
  });

  // G3 — AI 를 부르지 않고 이용권도 소진하지 않는다
  const bad = verdicts.find((v) => !v.ok);
  if (bad) {
    await exec("UPDATE analysis_request SET req_status = 'quality_rejected', quality_reject_reason = ? WHERE request_id = ?", [
      bad.reason!.slice(0, 200),
      requestId,
    ]);
    throw await gateError('G3', {
      reason: bad.reason,
      actorId: userId,
      subject: { kind: 'analysis_request', id: requestId },
      actions: [{ id: 'retry-upload', label: '사진 다시 올리기' }],
    });
  }

  await startAnalyzing(requestId, userId, isGuest);
  return { requestId, caseId };
}

/** R6 — 이용권 행을 잠그고 analyzing 으로. 트리거 trg_request_bu 가 같은 트랜잭션에서 재확인 */
async function startAnalyzing(requestId: number, userId: number, isGuest: boolean): Promise<void> {
  try {
    await withTransaction(async (conn) => {
      await query('SELECT entitlement_id FROM entitlement WHERE user_id = ? FOR UPDATE', [userId], conn);
      const pick = await queryOne<{ entitlement_id: number }>(
        `SELECT b.entitlement_id FROM v_entitlement_balance b JOIN entitlement e ON e.entitlement_id = b.entitlement_id
          WHERE b.user_id = ? AND b.is_usable = 1
          ORDER BY FIELD(b.ent_kind, 'free_trial', 'per_analysis', 'monthly'), e.valid_until IS NULL, e.valid_until, b.entitlement_id
          LIMIT 1`,
        [userId],
        conn,
      );
      if (!pick) throw new HttpError(402, 'g2', 'no entitlement');
      await exec(
        "UPDATE analysis_request SET req_status = 'analyzing', entitlement_id = ? WHERE request_id = ?",
        [pick.entitlement_id, requestId],
        conn,
      );
    });
  } catch (e: any) {
    if ((e instanceof HttpError && e.code === 'g2') || (e?.sqlMessage ?? '').startsWith('G2:')) {
      throw await g2Block(userId, isGuest, { kind: 'analysis_request', id: requestId });
    }
    throw e;
  }
  // 비동기 처리 — 화면은 폴링한다(SC-001: 60초 안)
  setImmediate(() => {
    runAi(requestId).catch((err) => console.error(`[analysis] ${requestId} 처리 오류`, err));
  });
}

export async function runAi(requestId: number): Promise<void> {
  const req = await queryOne<{ request_id: number; case_id: number; requester_id: number; description: string | null; req_status: string }>(
    'SELECT request_id, case_id, requester_id, description, req_status FROM analysis_request WHERE request_id = ?',
    [requestId],
  );
  if (!req || req.req_status !== 'analyzing') return;
  const photos = await query<{ storage_key: string }>('SELECT storage_key FROM analysis_photo WHERE request_id = ? ORDER BY photo_id', [
    requestId,
  ]);
  const started = Date.now();
  try {
    const buffers = await Promise.all(photos.map((p) => storage.read(p.storage_key)));
    const out = await aiAnalyzer().analyze({ photos: buffers, description: req.description });
    // R7 — 신뢰도 기준 미만이면 최소 caution (기준값 없으면 모델 값 그대로)
    const low = await aiLowConfidence();
    let risk: RiskLevel = out.riskLevel;
    if (low != null && out.confidence < low && risk === 'normal') risk = 'caution';
    const resultId = await withTransaction(async (conn) => {
      const notice = await currentNotice('analysis', conn);
      const r = await exec(
        "INSERT INTO analysis_result (request_id, notice_id, notice_kind, risk_level, ai_confidence) VALUES (?, ?, 'analysis', ?, ?)",
        [requestId, notice.noticeId, risk, out.confidence],
        conn,
      );
      for (const c of out.causes)
        await exec('INSERT INTO analysis_cause (result_id, cause_rank, cause_text) VALUES (?, ?, ?)', [r.insertId, c.rank, c.text], conn);
      for (const a of out.actions)
        await exec('INSERT INTO analysis_action (result_id, action_seq, action_text) VALUES (?, ?, ?)', [r.insertId, a.seq, a.text], conn);
      return r.insertId;
    });
    console.log(`[analysis] request ${requestId} completed in ${Date.now() - started}ms (risk=${risk})`);
    if (risk !== 'normal') await notifyRisk(req.case_id, resultId);
  } catch (e: any) {
    console.warn(`[analysis] request ${requestId} failed in ${Date.now() - started}ms: ${e.message}`);
    await exec("UPDATE analysis_request SET req_status = 'failed' WHERE request_id = ? AND req_status = 'analyzing'", [requestId]);
    await buildBlock('G4', {
      reason: e instanceof AiFailure && e.kind === 'timeout' ? 'AI 응답 시간이 초과되었습니다' : 'AI 분석 서비스가 응답하지 않았습니다',
      actorId: req.requester_id,
      subject: { kind: 'analysis_request', id: requestId },
    });
  }
}

/** FR-015 · FR-016 — 위험 통지는 트리거가 만든다. 건물 건이면 그 건물 관리자에게 알린다 */
async function notifyRisk(caseId: number, resultId: number) {
  const c = await queryOne<{ building_id: number | null; case_no: string }>(
    'SELECT building_id, case_no FROM defect_case WHERE case_id = ?',
    [caseId],
  );
  if (!c?.building_id) return;
  const managers = await query<{ user_id: number }>(
    `SELECT DISTINCT a.user_id FROM v_access_check a JOIN user_role r ON r.user_id = a.user_id AND r.role_code = 'building'
      WHERE a.building_id = ? AND a.access_kind = 'manage'`,
    [c.building_id],
  );
  for (const m of managers) {
    await notify(
      m.user_id,
      'risk_notice',
      { kind: 'analysis_result', id: resultId },
      `위험 통지: ${c.case_no} 전문가 점검이 권고되었습니다`,
      `/expert-requests/new?caseId=${caseId}`,
    );
  }
}

/** 실패한 요청 재시도: 같은 건·같은 사진으로 새 요청 (FR-013) */
export async function retryAnalysis(requestId: number, userId: number, isGuest: boolean) {
  const r = await queryOne<{ case_id: number; requester_id: number; description: string | null; req_status: string }>(
    'SELECT case_id, requester_id, description, req_status FROM analysis_request WHERE request_id = ?',
    [requestId],
  );
  if (!r || r.requester_id !== userId) throw new HttpError(404, 'not_found', '요청을 찾을 수 없습니다');
  if (r.req_status !== 'failed') throw new HttpError(409, 'not_failed', '실패한 요청만 다시 분석할 수 있습니다');
  const st = await entitlementStatus(userId, isGuest);
  if (!st.eligible) throw await g2Block(userId, isGuest);
  const newId = await withTransaction(async (conn) => {
    const n = await exec(
      'INSERT INTO analysis_request (case_id, requester_id, description) VALUES (?, ?, ?)',
      [r.case_id, userId, r.description],
      conn,
    );
    await exec(
      'INSERT INTO analysis_photo (request_id, storage_key, taken_at) SELECT ?, storage_key, taken_at FROM analysis_photo WHERE request_id = ?',
      [n.insertId, requestId],
      conn,
    );
    await releaseGates({ kind: 'analysis_request', id: requestId }, 'G4', userId, 'retry', conn);
    return n.insertId;
  });
  await startAnalyzing(newId, userId, isGuest);
  return { requestId: newId, caseId: r.case_id };
}

/** 같은 건의 연속 실패 수 — 3회 이상이면 운영 문의 안내(스펙 Assumptions) */
async function consecutiveFailures(caseId: number): Promise<number> {
  const rows = await query<{ req_status: string }>(
    'SELECT req_status FROM analysis_request WHERE case_id = ? ORDER BY request_id DESC LIMIT 10',
    [caseId],
  );
  let n = 0;
  for (const r of rows) {
    if (r.req_status === 'failed') n++;
    else break;
  }
  return n;
}

export async function requestDto(requestId: number) {
  const r = await queryOne<{
    request_id: number;
    case_id: number;
    case_no: string;
    requester_id: number;
    description: string | null;
    req_status: string;
    quality_reject_reason: string | null;
    requested_at: string;
    building_id: number | null;
  }>(
    `SELECT q.request_id, q.case_id, c.case_no, q.requester_id, q.description, q.req_status, q.quality_reject_reason, q.requested_at, c.building_id
       FROM analysis_request q JOIN defect_case c ON c.case_id = q.case_id WHERE q.request_id = ?`,
    [requestId],
  );
  if (!r) return null;
  const result = await queryOne<{ result_id: number }>('SELECT result_id FROM analysis_result WHERE request_id = ?', [requestId]);
  let gate: GateBlock | null = null;
  const fails = r.req_status === 'failed' ? await consecutiveFailures(r.case_id) : 0;
  if (r.req_status === 'failed') {
    gate = await buildBlock('G4', {
      record: false,
      reason:
        fails >= 3
          ? '3회 연속 실패했습니다 - 문제가 계속되면 운영팀(help@buildcare.local)에 문의해 주세요'
          : 'AI 분석 서비스가 응답하지 않았습니다 - 이용권은 소진되지 않았습니다',
      actions: [{ id: 'retry-analysis', label: '다시 분석 요청' }],
    });
  } else if (r.req_status === 'quality_rejected') {
    gate = await buildBlock('G3', {
      record: false,
      reason: r.quality_reject_reason ?? undefined,
      actions: [{ id: 'retry-upload', label: '사진 다시 올리기' }],
    });
  }
  return {
    requestId: r.request_id,
    caseId: r.case_id,
    caseNo: r.case_no,
    buildingId: r.building_id,
    description: r.description,
    status: r.req_status,
    qualityRejectReason: r.quality_reject_reason,
    requestedAt: r.requested_at,
    consecutiveFailures: fails,
    gate,
    result: result ? await resultDto(result.result_id) : null,
    photos: await analysisPhotos(requestId),
    progress: await caseProgress(r.case_id),
  };
}

/** 서버 재시작 등으로 analyzing 에 남은 요청 → failed (이용권 미소진 복구) */
export async function recoverStuckAnalyses(): Promise<number> {
  const r = await exec(
    "UPDATE analysis_request SET req_status = 'failed' WHERE req_status = 'analyzing' AND requested_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 3 MINUTE)",
  );
  if (r.affectedRows) console.warn(`[analysis] 멈춘 분석 ${r.affectedRows}건을 실패 처리했습니다`);
  return r.affectedRows;
}

export async function myCases(userId: number) {
  const rows = await query<{
    case_id: number;
    case_no: string;
    created_at: string;
    building_id: number | null;
    building_name: string | null;
    last_status: string | null;
    risk_level: string | null;
    result_id: number | null;
    last_request_id: number | null;
  }>(
    `SELECT c.case_id, c.case_no, c.created_at, c.building_id, b.building_name,
            (SELECT q.req_status FROM analysis_request q WHERE q.case_id = c.case_id ORDER BY q.request_id DESC LIMIT 1) AS last_status,
            (SELECT q.request_id FROM analysis_request q WHERE q.case_id = c.case_id ORDER BY q.request_id DESC LIMIT 1) AS last_request_id,
            (SELECT ar.risk_level FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id = c.case_id ORDER BY ar.result_id DESC LIMIT 1) AS risk_level,
            (SELECT ar.result_id FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id = c.case_id ORDER BY ar.result_id DESC LIMIT 1) AS result_id,
            (SELECT q.description FROM analysis_request q WHERE q.case_id = c.case_id ORDER BY q.request_id DESC LIMIT 1) AS description,
            (SELECT ac.cause_text FROM analysis_cause ac JOIN analysis_result ar ON ar.result_id = ac.result_id JOIN analysis_request q ON q.request_id = ar.request_id
              WHERE q.case_id = c.case_id AND ac.cause_rank = 1 ORDER BY ar.result_id DESC LIMIT 1) AS top_cause
       FROM defect_case c LEFT JOIN building b ON b.building_id = c.building_id
      WHERE c.owner_id = ? ORDER BY c.case_id DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    caseId: r.case_id,
    caseNo: r.case_no,
    createdAt: r.created_at,
    buildingId: r.building_id,
    buildingName: r.building_name,
    lastStatus: r.last_status,
    lastRequestId: r.last_request_id,
    riskLevel: r.risk_level,
    resultId: r.result_id,
    description: (r as any).description ?? null,
    topCause: (r as any).top_cause ?? null,
  }));
}
