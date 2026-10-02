import bcrypt from 'bcryptjs';

/** research R10 — bcrypt cost 12. R22 — 최소 10자 */
export const PASSWORD_MIN = 10;
const COST = 12;

export function validatePasswordPolicy(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호에 영문과 숫자를 함께 넣어 주세요';
  return null;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
