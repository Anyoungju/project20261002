import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { exec, query, queryOne, withTransaction, Db, getPool } from '../../db/pool';
import { newDeviceToken, setDeviceCookie } from '../../auth/tokens';
import { invalidateUser, loadPrincipal } from '../../auth/rbacService';
import { HttpError } from '../../lib/http';

/** 무료 체험 횟수 (FR-110: NULL 이면 체험 미발급) */
export async function freeTrialCount(db: Db = getPool()): Promise<number | null> {
  const r = await queryOne<{ const_value: string | null }>(
    "SELECT const_value FROM service_constant WHERE const_key = 'free_trial_count'",
    [],
    db,
  );
  const n = r?.const_value == null ? null : parseInt(r.const_value, 10);
  return Number.isFinite(n as number) && (n as number) > 0 ? (n as number) : null;
}

/**
 * 계정에 무료 체험 이용권을 "한 번만" 발급한다(research R10 — 가입·재가입으로 다시 생기지 않음).
 * 이미 free_trial 행이 있으면(소진 여부와 무관) 새로 만들지 않는다.
 */
export async function ensureFreeTrial(userId: number, db: Db = getPool()): Promise<void> {
  const has = await queryOne("SELECT 1 AS x FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial' LIMIT 1", [userId], db);
  if (has) return;
  const n = await freeTrialCount(db);
  if (!n) return;
  await exec("INSERT INTO entitlement (user_id, ent_kind, quota_total) VALUES (?, 'free_trial', ?)", [userId, n], db);
}

/** FR-120: 비회원 첫 분석 시 기기·비회원 계정을 만든다. 이미 있으면 그대로 */
export async function ensureGuest(req: Request, res: Response): Promise<number> {
  if (req.auth) return req.auth.userId;
  const { token, hash } = newDeviceToken();
  const guestId = await withTransaction(async (conn) => {
    const email = `guest+${crypto.randomUUID()}@guest.invalid`;
    const u = await exec("INSERT INTO user_account (email, display_name, is_guest) VALUES (?, '비회원', TRUE)", [email], conn);
    await exec("INSERT INTO user_role (user_id, role_code) VALUES (?, 'general')", [u.insertId], conn);
    await exec('INSERT INTO guest_device (token_hash, guest_user_id) VALUES (?, ?)', [hash, u.insertId], conn);
    await ensureFreeTrial(u.insertId, conn);
    return u.insertId;
  });
  setDeviceCookie(res, token);
  req.deviceTokenHash = hash;
  const p = await loadPrincipal(guestId);
  const d = await queryOne<{ device_id: number }>('SELECT device_id FROM guest_device WHERE token_hash = ?', [hash]);
  req.auth = { ...p!, viaSession: false, deviceId: d!.device_id, mustChangePassword: false };
  return guestId;
}

/** 로그인 직후: 이 기기에 계정 연결 가능한 비회원 분석이 있는가 */
export async function guestLinkable(deviceHash?: string): Promise<boolean> {
  if (!deviceHash) return false;
  const r = await queryOne(
    `SELECT 1 AS x FROM guest_device d JOIN defect_case c ON c.owner_id = d.guest_user_id
      WHERE d.token_hash = ? AND d.linked_user_id IS NULL LIMIT 1`,
    [deviceHash],
  );
  return !!r;
}

/**
 * FR-120a — 한 트랜잭션에서
 * ① 비회원 건·요청을 계정으로 이전 ② 비회원 체험 사용분을 계정 체험에 합산(계정 체험이 없으면 비회원 체험을 이전)
 * ③ 기기를 계정에 연결(이후 이 기기로 비회원 체험 재발급 없음)
 */
export async function linkGuest(userId: number, deviceHash?: string) {
  if (!deviceHash) throw new HttpError(404, 'no_device', '이 기기에 연결할 비회원 분석이 없습니다');
  const out = await withTransaction(async (conn) => {
    const d = await queryOne<{ device_id: number; guest_user_id: number; linked_user_id: number | null }>(
      'SELECT device_id, guest_user_id, linked_user_id FROM guest_device WHERE token_hash = ? FOR UPDATE',
      [deviceHash],
      conn,
    );
    if (!d || d.linked_user_id) throw new HttpError(404, 'no_device', '이 기기에 연결할 비회원 분석이 없습니다');
    const g = d.guest_user_id;
    const moved = await exec('UPDATE defect_case SET owner_id = ? WHERE owner_id = ?', [userId, g], conn);
    await exec('UPDATE analysis_request SET requester_id = ? WHERE requester_id = ?', [userId, g], conn);

    const guestTrial = await queryOne<{ entitlement_id: number }>(
      "SELECT entitlement_id FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial' ORDER BY entitlement_id LIMIT 1",
      [g],
      conn,
    );
    const userTrial = await queryOne<{ entitlement_id: number }>(
      "SELECT entitlement_id FROM entitlement WHERE user_id = ? AND ent_kind = 'free_trial' ORDER BY entitlement_id LIMIT 1",
      [userId],
      conn,
    );
    if (guestTrial) {
      if (userTrial) {
        // 합산: 비회원이 쓴 요청이 계정 체험을 가리키게 한다 (상태 변경이 아니므로 trg_request_bu 대상 아님)
        await exec(
          'UPDATE analysis_request SET entitlement_id = ? WHERE entitlement_id = ?',
          [userTrial.entitlement_id, guestTrial.entitlement_id],
          conn,
        );
      } else {
        await exec('UPDATE entitlement SET user_id = ? WHERE entitlement_id = ?', [userId, guestTrial.entitlement_id], conn);
      }
    }
    await exec(
      'UPDATE guest_device SET linked_user_id = ?, linked_at = CURRENT_TIMESTAMP WHERE device_id = ?',
      [userId, d.device_id],
      conn,
    );
    const remain = await query<{ remaining: number | null }>(
      "SELECT remaining FROM v_entitlement_balance WHERE user_id = ? AND ent_kind = 'free_trial'",
      [userId],
      conn,
    );
    const freeTrialRemaining = remain.length
      ? Math.max(
          0,
          remain.reduce((s, r) => s + (r.remaining ?? 0), 0),
        )
      : null;
    return { linkedCaseCount: moved.affectedRows, freeTrialRemaining };
  });
  invalidateUser(userId);
  return out;
}
