import { computed } from 'vue';
import { useSession } from '@/stores/session';

/** R22 — 화면은 권한 코드로만 판단한다 */
export function useCan() {
  const s = useSession();
  return {
    can: (code: string | string[]) => s.can(code),
    canRef: (code: string | string[]) => computed(() => s.can(code)),
  };
}

/** 위험도·상태 → StatusBadge tone */
export function riskTone(level?: string | null): 'ok' | 'warn' | 'danger' | 'ref' | 'na' {
  if (level === 'danger') return 'danger';
  if (level === 'caution') return 'warn';
  if (level === 'normal') return 'ok';
  return 'na';
}

export const RISK_LABEL: Record<string, string> = { normal: '정상', caution: '주의', danger: '위험' };

export function fmtDate(s?: string | null, withTime = false): string {
  if (!s) return '';
  const d = s.replace('T', ' ');
  return withTime ? d.slice(0, 16) : d.slice(0, 10);
}

export function fmtMoney(n?: number | null): string {
  return n == null ? '미설정' : `${n.toLocaleString('ko-KR')}원`;
}
