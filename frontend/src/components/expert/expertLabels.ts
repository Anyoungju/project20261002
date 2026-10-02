/** S8A · S8B 공통 라벨 — 상태는 글자 + 색 + 형태(StatusBadge tone) */
type Tone = 'ok' | 'warn' | 'danger' | 'ref' | 'na' | 'info';

export const REQUEST_STATUS: Record<string, { tone: Tone; label: string }> = {
  drafting: { tone: 'info', label: '작성 중' },
  awaiting: { tone: 'info', label: '수락 대기' },
  not_confirmed: { tone: 'warn', label: '미확정' },
  connected: { tone: 'ok', label: '연결 확정' },
  closed: { tone: 'na', label: '종료' },
};

export function requestStatus(s?: string | null) {
  return REQUEST_STATUS[s ?? ''] ?? { tone: 'na' as Tone, label: s ?? '-' };
}

export const ATTEMPT_RESPONSE: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: 'info', label: '응답 대기' },
  accepted: { tone: 'ok', label: '수락' },
  declined: { tone: 'warn', label: '거절' },
  no_response: { tone: 'na', label: '무응답' },
};

export function attemptResponse(r?: string | null) {
  return ATTEMPT_RESPONSE[r ?? 'pending'] ?? { tone: 'na' as Tone, label: r ?? '-' };
}

export const ORIGIN_LABEL: Record<string, string> = {
  analysis: 'AI 분석 위험 권고',
  verdict: '전문가 위험 판정',
  inspection: '정기점검 결과 위험',
  history: '건물 이력',
  priority: '우선순위 조치 지정',
  direct: '직접 요청',
};

/** ISO(UTC) 또는 'YYYY-MM-DD HH:mm:ss' → 'YYYY-MM-DD HH:mm' (브라우저 현지 시각) */
export function fmtDateTime(s?: string | null): string {
  if (!s) return '';
  if (!s.endsWith('Z')) return s.replace('T', ' ').slice(0, 16);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function feeText(amount: number | null | undefined): string {
  return amount == null ? '요율 미설정 - 수수료 기록 없음' : `${amount.toLocaleString('ko-KR')}원`;
}

export function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
