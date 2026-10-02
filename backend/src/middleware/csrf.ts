import type { RequestHandler } from 'express';
import crypto from 'node:crypto';
import { CSRF_COOKIE } from '../auth/tokens';

/** research R10 — 이중 제출 토큰. 안전한 메서드·웹훅은 제외 */
const EXEMPT = [/^\/api\/payments\/webhook$/];

export const csrf: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (EXEMPT.some((r) => r.test(req.path))) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('X-CSRF-Token');
  if (!cookie || !header || cookie.length !== header.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    res.status(403).json({ code: 'csrf', message: '보안 토큰이 맞지 않습니다 - 페이지를 새로고침해 주세요' });
    return;
  }
  next();
};
