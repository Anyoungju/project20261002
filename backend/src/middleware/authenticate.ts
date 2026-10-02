import type { RequestHandler, Request } from 'express';
import { queryOne } from '../db/pool';
import {
  SESSION_COOKIE,
  DEVICE_COOKIE,
  verifySession,
  clearSessionCookie,
  needsRefresh,
  setSessionCookie,
  hashDeviceToken,
} from '../auth/tokens';
import { loadPrincipal, Principal } from '../auth/rbacService';

export interface AuthContext extends Principal {
  /** 세션으로 로그인한 계정인지(비회원 기기 컨텍스트면 false) */
  viaSession: boolean;
  deviceId: number | null;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      sessionExpired?: boolean;
      deviceTokenHash?: string;
      requestId?: string;
    }
  }
}

/**
 * research R22 — 세션 쿠키 → token_version·disabled_at 대조 → principal.
 * 세션이 없고 bc_device 가 있으면 비회원 컨텍스트. 실패해도 여기서 막지 않는다(인가는 authorize 가).
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const claims = verifySession(token);
      if (!claims) {
        clearSessionCookie(res);
        req.sessionExpired = true;
      } else {
        const cred = await queryOne<{ token_version: number; disabled_at: string | null; must_change_password: number }>(
          'SELECT token_version, disabled_at, must_change_password FROM user_credential WHERE user_id = ?',
          [claims.sub],
        );
        if (!cred || cred.disabled_at || cred.token_version !== claims.tv) {
          clearSessionCookie(res);
          req.sessionExpired = true;
        } else {
          const p = await loadPrincipal(claims.sub);
          if (p) {
            req.auth = { ...p, viaSession: true, deviceId: null, mustChangePassword: !!cred.must_change_password };
            if (needsRefresh(claims)) setSessionCookie(res, claims.sub, cred.token_version);
          }
        }
      }
    }
    const device = req.cookies?.[DEVICE_COOKIE];
    if (device) req.deviceTokenHash = hashDeviceToken(device);
    if (!req.auth && req.deviceTokenHash) {
      const d = await queryOne<{ device_id: number; guest_user_id: number; linked_user_id: number | null }>(
        'SELECT device_id, guest_user_id, linked_user_id FROM guest_device WHERE token_hash = ?',
        [req.deviceTokenHash],
      );
      if (d && !d.linked_user_id) {
        const p = await loadPrincipal(d.guest_user_id);
        if (p) req.auth = { ...p, viaSession: false, deviceId: d.device_id, mustChangePassword: false };
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};

export function currentUserId(req: Request): number | null {
  return req.auth?.userId ?? null;
}
