import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { env, isProd } from '../config/env';

/** research R10 · R22 — JWT 에는 sub 와 tv(token_version)만 싣는다. 역할·권한은 요청마다 DB 에서 */
export const SESSION_COOKIE = 'bc_session';
export const DEVICE_COOKIE = 'bc_device';
export const CSRF_COOKIE = 'bc_csrf';

const SESSION_HOURS = 12;
const REFRESH_AFTER_SEC = 60 * 60; // 1시간 지나면 슬라이딩 재발급
const DEVICE_DAYS = 90;

export interface SessionClaims {
  sub: number;
  tv: number;
  iat?: number;
  exp?: number;
}

const secure = () => env.COOKIE_SECURE || isProd;

function baseCookie(): CookieOptions {
  return { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/' };
}

export function signSession(userId: number, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tv: tokenVersion }, env.JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const c = jwt.verify(token, env.JWT_SECRET) as any;
    return { sub: Number(c.sub), tv: Number(c.tv), iat: c.iat, exp: c.exp };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: number, tokenVersion: number): void {
  res.cookie(SESSION_COOKIE, signSession(userId, tokenVersion), { ...baseCookie(), maxAge: SESSION_HOURS * 3600_000 });
}

export function needsRefresh(c: SessionClaims): boolean {
  return !!c.iat && Date.now() / 1000 - c.iat > REFRESH_AFTER_SEC;
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseCookie());
}

/** 비회원 기기 토큰: 무작위 32바이트, DB 에는 SHA-256 만 */
export function newDeviceToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function setDeviceCookie(res: Response, token: string): void {
  res.cookie(DEVICE_COOKIE, token, { ...baseCookie(), maxAge: DEVICE_DAYS * 86400_000 });
}

/** CSRF 이중 제출: JS 가 읽어야 하므로 httpOnly 아님 */
export function issueCsrf(res: Response): string {
  const t = crypto.randomBytes(24).toString('base64url');
  res.cookie(CSRF_COOKIE, t, { httpOnly: false, secure: secure(), sameSite: 'lax', path: '/' });
  return t;
}
