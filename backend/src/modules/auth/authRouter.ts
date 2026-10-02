import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/http';
import { clearSessionCookie, issueCsrf, setSessionCookie } from '../../auth/tokens';
import { changePassword, login, meDto, principalAfterLogin } from './authService';
import { loginRequired, requireSession } from '../../middleware/authorize';
import { queryOne } from '../../db/pool';
import { guestLinkable } from './guestLinkService';

export const authRouter = Router();

authRouter.get(
  '/csrf',
  ah(async (_req, res) => {
    res.json({ token: issueCsrf(res) });
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const { userId, tokenVersion } = await login(body.email, body.password);
    setSessionCookie(res, userId, tokenVersion);
    const p = await principalAfterLogin(userId);
    const cred = await queryOne<{ must_change_password: number }>('SELECT must_change_password FROM user_credential WHERE user_id = ?', [
      userId,
    ]);
    const me = await meDto({ ...p!, viaSession: true, deviceId: null, mustChangePassword: !!cred?.must_change_password });
    res.json({ ...me, guestLinkable: await guestLinkable(req.deviceTokenHash) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  ah(async (req, res) => {
    if (!req.auth) throw await loginRequired(req);
    res.json({ ...(await meDto(req.auth)), guestLinkable: req.auth.viaSession ? await guestLinkable(req.deviceTokenHash) : false });
  }),
);

authRouter.post(
  '/password',
  requireSession(),
  ah(async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) }).parse(req.body);
    const tv = await changePassword(req.auth!.userId, body.currentPassword, body.newPassword);
    setSessionCookie(res, req.auth!.userId, tv);
    res.json({ ok: true });
  }),
);
