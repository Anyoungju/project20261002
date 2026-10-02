import { query, queryOne, Db, getPool } from '../db/pool';
import { ALL_PERMISSIONS, Role } from './permissions';

/** research R22 — 유효 역할 = user_role ∪ user_system_role ∪ (is_guest → guest). 권한 = rbac_role_permission 합집합 */
export interface Principal {
  userId: number;
  isGuest: boolean;
  orgId: number | null;
  roles: Role[];
  permissions: Set<string>;
}

const TTL_MS = 60_000;
const userCache = new Map<number, { at: number; p: Principal }>();
let matrixCache: { at: number; m: Map<string, Set<string>> } | null = null;

export function invalidateUser(userId: number): void {
  userCache.delete(userId);
}

export function invalidateAll(): void {
  userCache.clear();
  matrixCache = null;
}

export async function loadMatrix(db: Db = getPool()): Promise<Map<string, Set<string>>> {
  if (matrixCache && Date.now() - matrixCache.at < TTL_MS) return matrixCache.m;
  const rows = await query<{ role_code: string; permission_code: string }>(
    'SELECT role_code, permission_code FROM rbac_role_permission',
    [],
    db,
  );
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!m.has(r.role_code)) m.set(r.role_code, new Set());
    m.get(r.role_code)!.add(r.permission_code);
  }
  matrixCache = { at: Date.now(), m };
  return m;
}

export function permissionsFor(roles: string[], matrix: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const r of roles) for (const p of matrix.get(r) ?? []) out.add(p);
  return out;
}

export async function loadPrincipal(userId: number, db: Db = getPool()): Promise<Principal | null> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const u = await queryOne<{ user_id: number; is_guest: number; org_id: number | null }>(
    'SELECT user_id, is_guest, org_id FROM user_account WHERE user_id = ?',
    [userId],
    db,
  );
  if (!u) return null;
  const roleRows = await query<{ role_code: string }>(
    `SELECT role_code FROM user_role WHERE user_id = ?
     UNION SELECT role_code FROM user_system_role WHERE user_id = ?`,
    [userId, userId],
    db,
  );
  const roles = roleRows.map((r) => r.role_code) as Role[];
  if (u.is_guest) roles.splice(0, roles.length, 'guest');
  const matrix = await loadMatrix(db);
  const p: Principal = {
    userId,
    isGuest: !!u.is_guest,
    orgId: u.org_id,
    roles,
    permissions: permissionsFor(roles, matrix),
  };
  userCache.set(userId, { at: Date.now(), p });
  return p;
}

/** 기동 시 카탈로그 대조(permissions.ts ↔ rbac_permission) */
export async function verifyCatalog(): Promise<void> {
  const rows = await query<{ permission_code: string }>('SELECT permission_code FROM rbac_permission');
  const db = new Set(rows.map((r) => r.permission_code));
  const missing = ALL_PERMISSIONS.filter((p) => !db.has(p));
  const extra = [...db].filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
  if (missing.length || extra.length) {
    console.warn(`[rbac] 카탈로그 불일치 — DB 누락: ${missing.join(', ') || '-'} / 코드 누락: ${extra.join(', ') || '-'}`);
  }
}
