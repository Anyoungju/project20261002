import { env } from '../../config/env';
import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../../auth/password';
import { invalidateUser, loadPrincipal } from '../../auth/rbacService';
import { menuFor } from '../../auth/permissions';
import { maskedUser } from '../../lib/mask';
import { HttpError, unprocessable } from '../../lib/http';
import type { AuthContext } from '../../middleware/authenticate';

export interface MeDto {
  userId: number;
  isGuest: boolean;
  nameMasked: string;
  emailMasked: string;
  roles: string[];
  permissions: string[];
  orgId: number | null;
  menu: string[];
  mustChangePassword: boolean;
}

export async function meDto(auth: AuthContext): Promise<MeDto> {
  const m = await maskedUser(auth.userId);
  return {
    userId: auth.userId,
    isGuest: auth.isGuest,
    nameMasked: auth.isGuest ? '비회원' : (m?.nameMasked ?? ''),
    emailMasked: auth.isGuest ? '' : (m?.emailMasked ?? ''),
    roles: auth.roles,
    permissions: [...auth.permissions].sort(),
    orgId: auth.orgId,
    menu: menuFor(auth.permissions),
    mustChangePassword: auth.mustChangePassword,
  };
}

const normEmail = (e: string) => e.trim().toLowerCase();

/** R22 — 5회 연속 실패 시 15분 잠금 */
async function lockedUntil(email: string): Promise<Date | null> {
  const windowMin = env.AUTH_LOCK_MINUTES;
  const rows = await query<{ success: number; attempted_at: string }>(
    `SELECT success, attempted_at FROM auth_login_attempt
      WHERE email = ? AND attempted_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)
      ORDER BY attempted_at DESC, attempt_id DESC LIMIT ?`,
    [email, windowMin, env.AUTH_LOCK_MAX_FAILS],
  );
  if (rows.length < env.AUTH_LOCK_MAX_FAILS || rows.some((r) => r.success)) return null;
  const last = new Date(rows[0].attempted_at.replace(' ', 'T') + '+09:00');
  const until = new Date(last.getTime() + windowMin * 60_000);
  return until > new Date() ? until : null;
}

export async function login(emailRaw: string, password: string): Promise<{ userId: number; tokenVersion: number }> {
  const email = normEmail(emailRaw);
  const until = await lockedUntil(email);
  if (until) {
    const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    throw new HttpError(423, 'locked', `로그인 시도가 너무 많아 잠겼습니다 - ${min}분 후 다시 시도해 주세요`, {
      retryAfterMinutes: min,
    });
  }
  const row = await queryOne<{ user_id: number; password_hash: string; token_version: number; disabled_at: string | null }>(
    `SELECT u.user_id, c.password_hash, c.token_version, c.disabled_at
       FROM user_account u JOIN user_credential c ON c.user_id = u.user_id
      WHERE u.email = ? AND u.is_guest = FALSE`,
    [email],
  );
  const ok = !!row && !row.disabled_at && (await verifyPassword(password, row.password_hash));
  await exec('INSERT INTO auth_login_attempt (email, success) VALUES (?, ?)', [email, ok]);
  if (!ok) {
    throw new HttpError(401, 'invalid_credentials', '이메일 또는 비밀번호가 맞지 않습니다');
  }
  return { userId: row!.user_id, tokenVersion: row!.token_version };
}

export async function changePassword(userId: number, current: string, next: string): Promise<number> {
  const policy = validatePasswordPolicy(next);
  if (policy) throw unprocessable(policy, 'password_policy');
  const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM user_credential WHERE user_id = ?', [userId]);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw new HttpError(401, 'invalid_credentials', '현재 비밀번호가 맞지 않습니다');
  }
  if (current === next) throw unprocessable('새 비밀번호가 현재 비밀번호와 같습니다', 'password_same');
  const hash = await hashPassword(next);
  return withTransaction(async (conn) => {
    await exec(
      `UPDATE user_credential SET password_hash = ?, token_version = token_version + 1,
              must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [hash, userId],
      conn,
    );
    const r = await queryOne<{ token_version: number }>('SELECT token_version FROM user_credential WHERE user_id = ?', [userId], conn);
    invalidateUser(userId);
    return r!.token_version;
  });
}

export async function principalAfterLogin(userId: number) {
  invalidateUser(userId);
  return loadPrincipal(userId);
}
