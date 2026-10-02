import crypto from 'node:crypto';
import { exec, query, queryOne, withTransaction, Db } from '../../db/pool';
import { hashPassword } from '../../auth/password';
import { invalidateAll, invalidateUser } from '../../auth/rbacService';
import { ALL_ROLES, BUSINESS_ROLES, LOCKED_PERMISSIONS, PERMISSIONS } from '../../auth/permissions';
import { maskedUsers } from '../../lib/mask';
import { notify } from '../notification/notificationService';
import { HttpError, notFound, conflict } from '../../lib/http';
import type { AuthContext } from '../../middleware/authenticate';

async function audit(actorId: number, action: string, targetUserId: number | null, detail: unknown, db?: Db) {
  await exec(
    'INSERT INTO rbac_audit_log (actor_id, action, target_user_id, detail_json) VALUES (?, ?, ?, ?)',
    [actorId, action, targetUserId, JSON.stringify(detail ?? {}).slice(0, 2000)],
    db,
  );
}

const isOperator = (a: AuthContext) => a.roles.includes('operator');

// ------------------------------------------------------------------ 계정
export async function listUsers(a: AuthContext, f: { role?: string; q?: string; status?: string }) {
  const where = ['u.is_guest = FALSE'];
  const params: unknown[] = [];
  if (!isOperator(a)) {
    // 기업 관리자는 소속 조직 사용자만
    where.push('u.org_id = ?');
    params.push(a.orgId ?? -1);
  }
  if (f.role) {
    where.push(
      '(EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.user_id AND r.role_code = ?) OR EXISTS (SELECT 1 FROM user_system_role s WHERE s.user_id = u.user_id AND s.role_code = ?))',
    );
    params.push(f.role, f.role);
  }
  if (f.status === 'disabled') where.push('c.disabled_at IS NOT NULL');
  if (f.status === 'active') where.push('c.disabled_at IS NULL');
  if (f.q) {
    // 검색은 서버에서 원본으로 하되 응답은 마스킹만
    where.push('(u.email LIKE ? OR u.display_name LIKE ?)');
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  const rows = await query(
    `SELECT u.user_id, u.org_id, o.org_name, u.created_at, c.disabled_at, c.must_change_password,
            (SELECT GROUP_CONCAT(r.role_code ORDER BY r.role_code) FROM user_role r WHERE r.user_id = u.user_id) AS roles,
            (SELECT GROUP_CONCAT(s.role_code) FROM user_system_role s WHERE s.user_id = u.user_id) AS sys_roles
       FROM user_account u LEFT JOIN user_credential c ON c.user_id = u.user_id LEFT JOIN organization o ON o.org_id = u.org_id
      WHERE ${where.join(' AND ')} ORDER BY u.user_id LIMIT 300`,
    params,
  );
  const m = await maskedUsers(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    ...m.get(r.user_id)!,
    orgId: r.org_id,
    orgName: r.org_name,
    roles: [...(r.roles ? String(r.roles).split(',') : []), ...(r.sys_roles ? String(r.sys_roles).split(',') : [])],
    disabled: !!r.disabled_at,
    mustChangePassword: !!r.must_change_password,
    createdAt: r.created_at,
  }));
}

export async function userDetail(userId: number) {
  const u = await queryOne('SELECT user_id, org_id FROM user_account WHERE user_id = ? AND is_guest = FALSE', [userId]);
  if (!u) return null;
  const access = await query(
    `SELECT a.building_id, b.building_name, a.access_kind, a.granted_at FROM building_access a JOIN building b ON b.building_id = a.building_id
      WHERE a.user_id = ? ORDER BY b.building_name, a.access_kind`,
    [userId],
  );
  const list = await listUsersById(userId);
  return {
    ...list,
    buildingAccess: access.map((x) => ({
      buildingId: x.building_id,
      buildingName: x.building_name,
      accessKind: x.access_kind,
      grantedAt: x.granted_at,
    })),
  };
}

async function listUsersById(userId: number) {
  const r = await queryOne(
    `SELECT u.user_id, u.org_id, o.org_name, c.disabled_at, c.must_change_password,
            (SELECT GROUP_CONCAT(r.role_code ORDER BY r.role_code) FROM user_role r WHERE r.user_id = u.user_id) AS roles,
            (SELECT GROUP_CONCAT(s.role_code) FROM user_system_role s WHERE s.user_id = u.user_id) AS sys_roles
       FROM user_account u LEFT JOIN user_credential c ON c.user_id = u.user_id LEFT JOIN organization o ON o.org_id = u.org_id WHERE u.user_id = ?`,
    [userId],
  );
  const m = await maskedUsers([userId]);
  return {
    ...m.get(userId)!,
    orgId: r?.org_id ?? null,
    orgName: r?.org_name ?? null,
    roles: [...(r?.roles ? String(r.roles).split(',') : []), ...(r?.sys_roles ? String(r.sys_roles).split(',') : [])],
    disabled: !!r?.disabled_at,
    mustChangePassword: !!r?.must_change_password,
  };
}

function tempPassword(): string {
  // 영문+숫자 포함 12자
  const base = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
  return `${base.slice(0, 8)}A${Math.floor(Math.random() * 900 + 100)}`;
}

export async function createUser(
  a: AuthContext,
  b: { email: string; displayName: string; phone?: string | null; orgId?: number | null; roles: string[] },
) {
  const orgId = isOperator(a) ? (b.orgId ?? null) : a.orgId;
  const roles = b.roles.filter((r) => (BUSINESS_ROLES as readonly string[]).includes(r) || (r === 'operator' && isOperator(a)));
  if (!roles.length) throw new HttpError(422, 'roles_required', '역할을 하나 이상 선택해 주세요');
  if (!isOperator(a) && roles.includes('operator')) throw new HttpError(403, 'forbidden', '운영자 역할은 운영자만 부여할 수 있습니다');
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  const id = await withTransaction(async (conn) => {
    const dup = await queryOne('SELECT 1 AS x FROM user_account WHERE email = ?', [b.email.trim().toLowerCase()], conn);
    if (dup) throw conflict('이미 등록된 이메일입니다', 'email_exists');
    const u = await exec(
      'INSERT INTO user_account (email, display_name, phone, org_id) VALUES (?, ?, ?, ?)',
      [b.email.trim().toLowerCase(), b.displayName.trim(), b.phone?.trim() || null, orgId],
      conn,
    );
    await exec('INSERT INTO user_credential (user_id, password_hash, must_change_password) VALUES (?, ?, TRUE)', [u.insertId, hash], conn);
    for (const r of roles) {
      if (r === 'operator') await exec("INSERT INTO user_system_role (user_id, role_code) VALUES (?, 'operator')", [u.insertId], conn);
      else await exec('INSERT INTO user_role (user_id, role_code) VALUES (?, ?)', [u.insertId, r], conn);
    }
    await audit(a.userId, 'user.create', u.insertId, { roles, orgId }, conn);
    return u.insertId;
  });
  return { user: await listUsersById(id), temporaryPassword: pw };
}

async function assertManageable(a: AuthContext, userId: number) {
  const u = await queryOne<{ org_id: number | null; is_guest: number }>('SELECT org_id, is_guest FROM user_account WHERE user_id = ?', [
    userId,
  ]);
  if (!u || u.is_guest) throw notFound('사용자를 찾을 수 없습니다');
  if (!isOperator(a) && u.org_id !== a.orgId) throw new HttpError(403, 'forbidden', '소속 조직 밖의 사용자입니다');
}

async function operatorCount(db?: Db) {
  const r = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM user_system_role s JOIN user_credential c ON c.user_id = s.user_id WHERE s.role_code = 'operator' AND c.disabled_at IS NULL",
    [],
    db,
  );
  return Number(r?.n ?? 0);
}

export async function setRoles(a: AuthContext, userId: number, roles: string[]) {
  await assertManageable(a, userId);
  const valid = roles.filter((r) => (ALL_ROLES as readonly string[]).includes(r) && r !== 'guest');
  if (!isOperator(a) && valid.includes('operator')) throw new HttpError(403, 'forbidden', '운영자 역할은 운영자만 부여할 수 있습니다');
  await withTransaction(async (conn) => {
    const wasOp = !!(await queryOne("SELECT 1 AS x FROM user_system_role WHERE user_id = ? AND role_code = 'operator'", [userId], conn));
    if (wasOp && !valid.includes('operator') && (await operatorCount(conn)) <= 1) {
      throw new HttpError(409, 'last_operator', '마지막 운영자의 운영자 역할은 뗄 수 없습니다');
    }
    if (!isOperator(a) && wasOp) throw new HttpError(403, 'forbidden', '운영자 계정은 운영자만 바꿀 수 있습니다');
    await exec('DELETE FROM user_role WHERE user_id = ?', [userId], conn);
    for (const r of valid.filter((x) => (BUSINESS_ROLES as readonly string[]).includes(x))) {
      await exec('INSERT INTO user_role (user_id, role_code) VALUES (?, ?)', [userId, r], conn);
    }
    if (isOperator(a)) {
      await exec('DELETE FROM user_system_role WHERE user_id = ?', [userId], conn);
      if (valid.includes('operator'))
        await exec("INSERT INTO user_system_role (user_id, role_code) VALUES (?, 'operator')", [userId], conn);
    }
    // R22 — 역할 변경 즉시 기존 세션 무효화
    await exec('UPDATE user_credential SET token_version = token_version + 1 WHERE user_id = ?', [userId], conn);
    await audit(a.userId, 'user.roles', userId, { roles: valid }, conn);
  });
  invalidateUser(userId);
  return listUsersById(userId);
}

export async function setDisabled(a: AuthContext, userId: number, disabled: boolean) {
  await assertManageable(a, userId);
  if (userId === a.userId && disabled) throw new HttpError(409, 'self_disable', '자기 계정은 비활성화할 수 없습니다');
  await withTransaction(async (conn) => {
    const isOp = !!(await queryOne("SELECT 1 AS x FROM user_system_role WHERE user_id = ? AND role_code = 'operator'", [userId], conn));
    if (isOp && disabled && (await operatorCount(conn)) <= 1)
      throw new HttpError(409, 'last_operator', '마지막 운영자는 비활성화할 수 없습니다');
    await exec(
      `UPDATE user_credential SET disabled_at = ${disabled ? 'CURRENT_TIMESTAMP' : 'NULL'}, token_version = token_version + 1 WHERE user_id = ?`,
      [userId],
      conn,
    );
    await audit(a.userId, disabled ? 'user.disable' : 'user.enable', userId, {}, conn);
  });
  invalidateUser(userId);
  return listUsersById(userId);
}

export async function resetPassword(a: AuthContext, userId: number) {
  await assertManageable(a, userId);
  const pw = tempPassword();
  await exec(
    'UPDATE user_credential SET password_hash = ?, must_change_password = TRUE, token_version = token_version + 1 WHERE user_id = ?',
    [await hashPassword(pw), userId],
  );
  await audit(a.userId, 'user.reset_password', userId, {});
  invalidateUser(userId);
  return { temporaryPassword: pw };
}

// ------------------------------------------------------------------ 건물 권한
async function assertBuildingScope(a: AuthContext, buildingId: number) {
  const b = await queryOne<{ org_id: number | null }>('SELECT org_id FROM building WHERE building_id = ?', [buildingId]);
  if (!b) throw notFound('건물을 찾을 수 없습니다');
  if (!isOperator(a) && (b.org_id == null || b.org_id !== a.orgId)) {
    throw new HttpError(403, 'forbidden', '소속 조직의 건물에만 권한을 줄 수 있습니다');
  }
}

export async function grantAccess(a: AuthContext, userId: number, buildingId: number, kind: 'record' | 'manage') {
  const u = await queryOne('SELECT 1 AS x FROM user_account WHERE user_id = ? AND is_guest = FALSE', [userId]);
  if (!u) throw notFound('사용자를 찾을 수 없습니다');
  await assertBuildingScope(a, buildingId);
  await exec('INSERT IGNORE INTO building_access (user_id, building_id, access_kind) VALUES (?, ?, ?)', [userId, buildingId, kind]);
  await audit(a.userId, 'access.grant', userId, { buildingId, kind });
  invalidateUser(userId);
}

export async function revokeAccess(a: AuthContext, userId: number, buildingId: number, kind: 'record' | 'manage') {
  await assertBuildingScope(a, buildingId);
  await exec('DELETE FROM building_access WHERE user_id = ? AND building_id = ? AND access_kind = ?', [userId, buildingId, kind]);
  await audit(a.userId, 'access.revoke', userId, { buildingId, kind });
  invalidateUser(userId);
}

// ------------------------------------------------------------------ 권한 요청
export async function listPermissionRequests(a: AuthContext, status: 'pending' | 'all') {
  const rows = await query(
    `SELECT p.perm_req_id, p.requester_id, p.building_id, b.building_name, p.org_id, o.org_name, p.requested_screen, p.requested_at,
            p.resolution, p.resolved_by, p.resolved_at
       FROM permission_request p LEFT JOIN building b ON b.building_id = p.building_id LEFT JOIN organization o ON o.org_id = p.org_id
      WHERE 1 = 1 ${isOperator(a) ? '' : 'AND p.org_id = ?'} ${status === 'pending' ? 'AND p.resolution IS NULL' : ''}
      ORDER BY p.resolution IS NULL DESC, p.requested_at DESC LIMIT 200`,
    isOperator(a) ? [] : [a.orgId ?? -1],
  );
  const m = await maskedUsers(rows.flatMap((r) => [r.requester_id, r.resolved_by]).filter(Boolean));
  const roles = rows.length
    ? await query<{ user_id: number; role_code: string }>('SELECT user_id, role_code FROM user_role WHERE user_id IN (?)', [
        rows.map((r) => r.requester_id),
      ])
    : [];
  return rows.map((r) => ({
    permReqId: r.perm_req_id,
    requester: m.get(r.requester_id) ?? null,
    requesterRoles: roles.filter((x) => x.user_id === r.requester_id).map((x) => x.role_code),
    buildingId: r.building_id,
    buildingName: r.building_name,
    orgId: r.org_id,
    orgName: r.org_name,
    requestedScreen: r.requested_screen,
    requestedAt: r.requested_at,
    resolution: r.resolution,
    resolvedBy: r.resolved_by ? (m.get(r.resolved_by) ?? null) : null,
    resolvedAt: r.resolved_at,
  }));
}

export async function resolvePermissionRequest(
  a: AuthContext,
  permReqId: number,
  resolution: 'granted' | 'rejected',
  accessKind?: 'record' | 'manage',
) {
  const p = await queryOne<{
    requester_id: number;
    building_id: number | null;
    org_id: number | null;
    resolution: string | null;
    requested_screen: string;
  }>('SELECT requester_id, building_id, org_id, resolution, requested_screen FROM permission_request WHERE perm_req_id = ?', [permReqId]);
  if (!p) throw notFound('권한 요청을 찾을 수 없습니다');
  if (!isOperator(a) && p.org_id !== a.orgId) throw new HttpError(403, 'forbidden', '소속 조직의 요청만 처리할 수 있습니다');
  if (p.resolution) throw conflict('이미 처리된 요청입니다', 'resolved');
  if (resolution === 'granted' && !p.building_id)
    throw new HttpError(422, 'no_building', '건물이 지정되지 않은 요청은 계정 관리에서 역할로 처리해 주세요');
  const kind = accessKind ?? (['S5', 'S7A', 'S8A'].includes(p.requested_screen) ? 'manage' : 'record');
  await withTransaction(async (conn) => {
    await exec(
      'UPDATE permission_request SET resolution = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE perm_req_id = ?',
      [resolution, a.userId, permReqId],
      conn,
    );
    if (resolution === 'granted' && p.building_id) {
      await exec(
        'INSERT IGNORE INTO building_access (user_id, building_id, access_kind) VALUES (?, ?, ?)',
        [p.requester_id, p.building_id, kind],
        conn,
      );
      // FR-007 — G0 해제 기록
      await exec(
        "UPDATE gate_event SET released_at = CURRENT_TIMESTAMP, released_by = ?, release_action = 'permission_granted' WHERE gate_code = 'G0' AND subject_kind = 'building' AND subject_id = ? AND actor_id = ? AND released_at IS NULL",
        [a.userId, p.building_id, p.requester_id],
        conn,
      );
    }
    await audit(a.userId, `permreq.${resolution}`, p.requester_id, { permReqId, buildingId: p.building_id, kind }, conn);
  });
  invalidateUser(p.requester_id);
  await notify(
    p.requester_id,
    'permission_resolved',
    { kind: 'permission_request', id: permReqId },
    resolution === 'granted' ? '권한 요청이 승인되었습니다 - 해당 화면을 다시 열어 주세요' : '권한 요청이 거절되었습니다',
  );
}

// ------------------------------------------------------------------ 매트릭스
export async function matrix() {
  const perms = await query<{ permission_code: string; description: string; locked: number }>(
    'SELECT permission_code, description, locked FROM rbac_permission ORDER BY permission_code',
  );
  const rp = await query<{ role_code: string; permission_code: string }>('SELECT role_code, permission_code FROM rbac_role_permission');
  return {
    roles: ALL_ROLES,
    permissions: perms.map((p) => ({ code: p.permission_code, description: p.description, locked: !!p.locked })),
    grants: Object.fromEntries(
      ALL_ROLES.map((r) => [
        r,
        rp
          .filter((x) => x.role_code === r)
          .map((x) => x.permission_code)
          .sort(),
      ]),
    ),
  };
}

export async function setRolePermissions(a: AuthContext, role: string, permissions: string[]) {
  if (!(ALL_ROLES as readonly string[]).includes(role)) throw new HttpError(422, 'invalid_role', '알 수 없는 역할입니다');
  const valid = [...new Set(permissions.filter((p) => p in PERMISSIONS))];
  if (role === 'operator') {
    for (const l of LOCKED_PERMISSIONS)
      if (!valid.includes(l)) throw new HttpError(409, 'locked_permission', `잠긴 권한(${l})은 운영자에게서 뗄 수 없습니다`);
  }
  if (role === 'guest' && valid.some((p) => p.startsWith('admin.') || p.endsWith('.grant') || p.endsWith('.resolve'))) {
    throw new HttpError(422, 'guest_admin', '비회원에게 관리 권한을 줄 수 없습니다');
  }
  await withTransaction(async (conn) => {
    await exec('DELETE FROM rbac_role_permission WHERE role_code = ?', [role], conn);
    for (const p of valid) await exec('INSERT INTO rbac_role_permission (role_code, permission_code) VALUES (?, ?)', [role, p], conn);
    await audit(a.userId, 'rbac.role_permissions', null, { role, permissions: valid }, conn);
  });
  invalidateAll();
  return matrix();
}

export async function auditLog(a: AuthContext) {
  const rows = await query(
    `SELECT l.audit_id, l.actor_id, l.action, l.target_user_id, l.detail_json, l.at FROM rbac_audit_log l
      ${isOperator(a) ? '' : 'JOIN user_account u ON u.user_id = l.actor_id WHERE u.org_id = ?'}
      ORDER BY l.audit_id DESC LIMIT 200`,
    isOperator(a) ? [] : [a.orgId ?? -1],
  );
  const m = await maskedUsers(rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter(Boolean));
  return rows.map((r) => ({
    auditId: r.audit_id,
    actor: m.get(r.actor_id) ?? null,
    action: r.action,
    target: r.target_user_id ? (m.get(r.target_user_id) ?? null) : null,
    detail: (() => {
      try {
        return JSON.parse(r.detail_json ?? '{}');
      } catch {
        return {};
      }
    })(),
    at: r.at,
  }));
}

export async function gateEvents() {
  const rows = await query(
    'SELECT event_id, gate_code, actor_id, subject_kind, subject_id, reason_text, occurred_at, released_at, release_action FROM gate_event ORDER BY event_id DESC LIMIT 200',
  );
  return rows.map((r) => ({
    eventId: r.event_id,
    gateCode: r.gate_code,
    actorId: r.actor_id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    reason: r.reason_text,
    occurredAt: r.occurred_at,
    releasedAt: r.released_at,
    releaseAction: r.release_action,
  }));
}

// ------------------------------------------------------------------ 기준값·고지
export async function constants() {
  const rows = await query('SELECT const_key, const_value, unit, description FROM service_constant ORDER BY const_key');
  return rows.map((r) => ({ key: r.const_key, value: r.const_value, unit: r.unit, description: r.description }));
}

export async function setConstant(a: AuthContext, key: string, value: string | null) {
  const r = await exec('UPDATE service_constant SET const_value = ? WHERE const_key = ?', [value === '' ? null : value, key]);
  if (!r.affectedRows) throw notFound('기준값 키를 찾을 수 없습니다');
  await audit(a.userId, 'constant.set', null, { key, value });
  return (await constants()).find((c) => c.key === key);
}

export async function plansAdmin() {
  return query('SELECT plan_code, plan_name, price_amount, analysis_quota, period_months FROM service_plan');
}

export async function setPlanPrice(a: AuthContext, planCode: string, price: number | null) {
  const r = await exec('UPDATE service_plan SET price_amount = ? WHERE plan_code = ?', [price, planCode]);
  if (!r.affectedRows) throw notFound('요금제를 찾을 수 없습니다');
  await audit(a.userId, 'plan.price', null, { planCode, price });
}

export async function notices() {
  const rows = await query('SELECT notice_id, notice_kind, body, effective_from FROM notice_text ORDER BY notice_kind, notice_id DESC');
  return rows.map((r) => ({ noticeId: r.notice_id, kind: r.notice_kind, body: r.body, effectiveFrom: r.effective_from }));
}

/** FR-018 — 고지 변경 = 새 판본 INSERT (과거 결과는 당시 판본 유지) */
export async function addNotice(a: AuthContext, kind: string, body: string) {
  const r = await exec('INSERT INTO notice_text (notice_kind, body) VALUES (?, ?)', [kind, body.trim()]);
  await audit(a.userId, 'notice.add', null, { kind, noticeId: r.insertId });
  return { noticeId: r.insertId, kind, body: body.trim() };
}

export async function orgsAndBuildings(a: AuthContext) {
  const orgs = await query('SELECT org_id, org_name, license_expires_on FROM organization ORDER BY org_name');
  const blds = await query('SELECT building_id, building_name, org_id FROM building ORDER BY building_name');
  const scope = isOperator(a) ? null : a.orgId;
  return {
    orgs: orgs
      .filter((o) => scope == null || o.org_id === scope)
      .map((o) => ({ orgId: o.org_id, orgName: o.org_name, licenseExpiresOn: o.license_expires_on })),
    buildings: blds
      .filter((b) => scope == null || b.org_id === scope)
      .map((b) => ({ buildingId: b.building_id, buildingName: b.building_name, orgId: b.org_id })),
  };
}
