import type { Request, RequestHandler } from 'express';
import { queryOne, Db, getPool } from '../db/pool';
import { gateError, GateBlockError } from '../gates/gateBlock';
import type { Permission } from '../auth/permissions';
import { ah } from '../lib/http';

/**
 * research R22 — 두 층 인가. ① requirePermission(RBAC) ② requireBuildingAccess / requireCaseAccess(v_access_check).
 * 거부는 모두 G0 GateBlock(미로그인 401, 권한 없음 403) + gate_event.
 */

export async function loginRequired(req: Request): Promise<GateBlockError> {
  return gateError('G0', {
    status: 401,
    selfRelease: true,
    reason: req.sessionExpired ? '세션이 만료되었습니다 - 다시 로그인해 주세요' : '로그인이 필요합니다',
    actions: [{ id: 'login', label: '로그인', href: '/login' }],
    record: false,
  });
}

export async function forbidden(
  req: Request,
  reason: string,
  subject?: { kind: 'building' | 'organization' | 'user_account'; id: number },
): Promise<GateBlockError> {
  const actorId = req.auth?.userId ?? null;
  return gateError('G0', {
    status: 403,
    reason,
    actorId,
    // gate_event 는 subject 가 필수 — 없으면 행위자 자신을 대상으로 남긴다
    subject: subject ?? (actorId ? { kind: 'user_account', id: actorId } : undefined),
    actions: [{ id: 'permission-request', label: '권한 요청 보내기' }],
  });
}

/** 비회원(기기)도 permission 이 있으면 통과한다. 그 외는 세션 필수 */
export function requirePermission(...codes: Permission[]): RequestHandler {
  return ah(async (req, _res, next) => {
    const a = req.auth;
    if (!a) throw await loginRequired(req);
    if (!codes.some((c) => a.permissions.has(c))) {
      if (a.isGuest) throw await loginRequired(req);
      throw await forbidden(req, '이 기능을 사용할 역할 권한이 없습니다');
    }
    if (a.mustChangePassword && !req.path.startsWith('/api/auth')) {
      throw await forbidden(req, '임시 비밀번호를 먼저 변경해 주세요');
    }
    next();
  });
}

export function requireSession(): RequestHandler {
  return ah(async (req, _res, next) => {
    if (!req.auth || !req.auth.viaSession) throw await loginRequired(req);
    next();
  });
}

export type AccessKind = 'record' | 'manage' | 'any';

/** G0 판정 단일 지점: v_access_check */
export async function hasBuildingAccess(userId: number, buildingId: number, kind: AccessKind, db: Db = getPool()) {
  const row = await queryOne(
    kind === 'any'
      ? 'SELECT 1 AS ok FROM v_access_check WHERE user_id = ? AND building_id = ? LIMIT 1'
      : 'SELECT 1 AS ok FROM v_access_check WHERE user_id = ? AND building_id = ? AND access_kind = ? LIMIT 1',
    kind === 'any' ? [userId, buildingId] : [userId, buildingId, kind],
    db,
  );
  return !!row;
}

export async function assertBuildingAccess(req: Request, buildingId: number, kind: AccessKind | AccessKind[]) {
  const a = req.auth;
  if (!a) throw await loginRequired(req);
  const kinds = Array.isArray(kind) ? kind : [kind];
  for (const k of kinds) if (await hasBuildingAccess(a.userId, buildingId, k)) return;
  throw await forbidden(req, '이 건물에 대한 권한이 없습니다', { kind: 'building', id: buildingId });
}

export function requireBuildingAccess(kind: AccessKind | AccessKind[], param = 'buildingId'): RequestHandler {
  return ah(async (req, _res, next) => {
    const id = Number(req.params[param] ?? req.query[param] ?? (req.body ?? {})[param]);
    if (!Number.isInteger(id) || id <= 0) throw await forbidden(req, '건물이 지정되지 않았습니다');
    await assertBuildingAccess(req, id, kind);
    next();
  });
}

/**
 * 하자 건 접근: 소유자(비회원 미연결 건은 그 기기 계정만 — FR-120b) 또는 건 건물의 권한자, 또는 그 건의 검증·요청에 관여한 전문가.
 */
export async function canAccessCase(req: Request, caseId: number, db: Db = getPool()): Promise<boolean> {
  const a = req.auth;
  if (!a) return false;
  const c = await queryOne<{ owner_id: number; building_id: number | null }>(
    'SELECT owner_id, building_id FROM defect_case WHERE case_id = ?',
    [caseId],
    db,
  );
  if (!c) return false;
  if (c.owner_id === a.userId) return true;
  if (a.isGuest) return false;
  if (c.building_id && (await hasBuildingAccess(a.userId, c.building_id, 'any', db))) return true;
  if (a.roles.includes('operator')) return true;
  if (a.roles.includes('expert')) {
    const v = await queryOne(
      `SELECT 1 AS ok FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
        WHERE r.case_id = ? LIMIT 1`,
      [caseId],
      db,
    );
    if (v) return true;
    const t = await queryOne(
      `SELECT 1 AS ok FROM expert_request_attempt t JOIN expert_request er ON er.exp_req_id = t.exp_req_id
        WHERE er.case_id = ? AND t.expert_id = ? LIMIT 1`,
      [caseId, a.userId],
      db,
    );
    if (t) return true;
  }
  return false;
}

export async function assertCaseAccess(req: Request, caseId: number): Promise<void> {
  if (!req.auth) throw await loginRequired(req);
  if (!(await canAccessCase(req, caseId))) throw await forbidden(req, '이 하자 건을 볼 권한이 없습니다');
}

/** 기업 관리자 소속 조직 범위 */
export async function assertOrgScope(req: Request, orgId: number): Promise<void> {
  const a = req.auth;
  if (!a) throw await loginRequired(req);
  if (a.roles.includes('operator')) return;
  if (a.orgId !== orgId) throw await forbidden(req, '소속 조직 밖의 대상입니다', { kind: 'organization', id: orgId });
}
