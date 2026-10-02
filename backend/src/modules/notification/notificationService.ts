import { exec, queryOne, Db, getPool } from '../../db/pool';
import { sendMail } from '../../adapters/mail';

/** R18 — 서비스 내 알림 + 이메일(개발은 console). 비회원·가상 이메일에는 메일을 보내지 않는다 */
export async function notify(
  recipientId: number,
  kind: string,
  ref: { kind: string; id: number } | null,
  title: string,
  link?: string,
  db: Db = getPool(),
): Promise<number> {
  const r = await exec(
    'INSERT INTO notification (recipient_id, kind, ref_kind, ref_id, title, link) VALUES (?, ?, ?, ?, ?, ?)',
    [recipientId, kind, ref?.kind ?? null, ref?.id ?? null, title.slice(0, 200), link ?? null],
    db,
  );
  const u = await queryOne<{ email: string; is_guest: number }>(
    'SELECT email, is_guest FROM user_account WHERE user_id = ?',
    [recipientId],
    db,
  );
  if (u && !u.is_guest && !u.email.endsWith('.invalid')) {
    sendMail(u.email, `[Buildcare AI] ${title}`, `${title}\n\n${link ? `바로가기: ${link}` : ''}`).catch((e) =>
      console.error('[mail]', e.message),
    );
  }
  return r.insertId;
}
