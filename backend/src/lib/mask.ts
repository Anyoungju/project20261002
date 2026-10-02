import { query, Db, getPool } from '../db/pool';

/** FR-090: 사용자 정보는 v_user_masked 필드만 응답한다. 원본 email/phone/display_name 을 직렬화하지 않는다. */
export interface MaskedUser {
  userId: number;
  nameMasked: string;
  emailMasked: string;
  phoneMasked: string | null;
}

export async function maskedUsers(ids: number[], db: Db = getPool()): Promise<Map<number, MaskedUser>> {
  const uniq = [...new Set(ids.filter((x) => x != null))];
  if (!uniq.length) return new Map();
  const rows = await query<{ user_id: number; email_masked: string; name_masked: string; phone_masked: string | null }>(
    'SELECT user_id, email_masked, name_masked, phone_masked FROM v_user_masked WHERE user_id IN (?)',
    [uniq],
    db,
  );
  return new Map(
    rows.map((r) => [
      r.user_id,
      { userId: r.user_id, nameMasked: r.name_masked, emailMasked: r.email_masked, phoneMasked: r.phone_masked },
    ]),
  );
}

export async function maskedUser(id: number, db?: Db): Promise<MaskedUser | null> {
  return (await maskedUsers([id], db)).get(id) ?? null;
}

/** 순수 함수 판본 — 단위 테스트·DB 없이 형식 확인용 (v_user_masked 와 같은 규칙) */
export function maskLikeView(u: { email: string; display_name: string; phone?: string | null }) {
  const tld = u.email.split('.').pop();
  return {
    emailMasked: `***@***.${tld}`,
    nameMasked: `${[...u.display_name][0] ?? ''}**`,
    phoneMasked: u.phone ? `${u.phone.slice(0, 3)}-****-${u.phone.slice(-4)}` : null,
  };
}
