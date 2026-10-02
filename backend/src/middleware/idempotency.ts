import type { RequestHandler } from 'express';
import { exec, queryOne } from '../db/pool';

/**
 * research R14 — Idempotency-Key. 같은 (키, 사용자, 경로) 요청은 한 번만 처리하고 저장한 응답을 다시 준다.
 * 처리 중인 같은 키가 오면 409.
 */
export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.get('Idempotency-Key');
  if (!key) return next();
  if (key.length > 100) {
    res.status(400).json({ code: 'bad_idempotency_key', message: 'Idempotency-Key 가 너무 깁니다' });
    return;
  }
  const scope = req.auth ? `u:${req.auth.userId}` : `d:${req.deviceTokenHash?.slice(0, 40) ?? 'anon'}`;
  const route = `${req.method} ${req.baseUrl}${req.path}`.slice(0, 200);
  try {
    const prev = await queryOne<{ status_code: number | null; response_body: string | null; created_at: string }>(
      'SELECT status_code, response_body, created_at FROM idempotency_record WHERE idem_key = ? AND user_scope = ? AND route = ?',
      [key, scope, route],
    );
    if (prev) {
      if (prev.status_code == null) {
        res.status(409).json({ code: 'in_progress', message: '처리 중입니다' });
        return;
      }
      res
        .status(prev.status_code)
        .type('application/json')
        .send(prev.response_body ?? '{}');
      return;
    }
    await exec('INSERT INTO idempotency_record (idem_key, user_scope, route) VALUES (?, ?, ?)', [key, scope, route]);
  } catch (e: any) {
    if (e?.errno === 1062) {
      res.status(409).json({ code: 'in_progress', message: '처리 중입니다' });
      return;
    }
    return next(e);
  }

  const origJson = res.json.bind(res);
  res.json = (body: any) => {
    const status = res.statusCode;
    // 5xx 는 저장하지 않고 키를 지워 재시도를 허용한다
    const p =
      status >= 500
        ? exec('DELETE FROM idempotency_record WHERE idem_key = ? AND user_scope = ? AND route = ?', [key, scope, route])
        : exec('UPDATE idempotency_record SET status_code = ?, response_body = ? WHERE idem_key = ? AND user_scope = ? AND route = ?', [
            status,
            JSON.stringify(body ?? {}),
            key,
            scope,
            route,
          ]);
    p.catch((e) => console.error('[idempotency]', e.message));
    return origJson(body);
  };
  next();
};
