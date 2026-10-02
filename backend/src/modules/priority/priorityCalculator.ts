/**
 * research R16 — 유지관리 우선순위 산식(순수 함수).
 * 점수 = w_repeat × 재발 횟수 + w_risk × 최고 위험도(정상0·주의1·위험2) + w_age × min(미조치 개월, 12)/3 + w_notice × 열린 위험 통지 수
 * 신뢰도: 묶음 이력 수 < pattern_min_records (미설정이면 항상 low)
 */
export interface Weights {
  repeat: number;
  risk: number;
  age: number;
  openNotice: number;
}

export const DEFAULT_WEIGHTS: Weights = { repeat: 3, risk: 2, age: 1, openNotice: 2 };

export interface GroupInput {
  buildingId: number;
  locationText: string | null;
  defectTypeCode: string;
  entryCount: number;
  maxRisk: 0 | 1 | 2;
  unresolvedMonths: number;
  openNotices: number;
  basis: Array<{ recordId?: number; extId?: number }>;
}

export interface RankedItem extends GroupInput {
  rank: number;
  score: number;
  confidence: 'normal' | 'low';
}

export function scoreGroup(g: GroupInput, w: Weights = DEFAULT_WEIGHTS): number {
  const age = Math.min(Math.max(g.unresolvedMonths, 0), 12) / 3;
  return Math.round((w.repeat * g.entryCount + w.risk * g.maxRisk + w.age * age + w.openNotice * g.openNotices) * 100) / 100;
}

export function rankGroups(groups: GroupInput[], minRecords: number | null, w: Weights = DEFAULT_WEIGHTS): RankedItem[] {
  return groups
    .filter((g) => g.basis.length > 0) // FR-064 — 근거 없는 항목은 만들지 않는다
    .map((g) => ({
      ...g,
      score: scoreGroup(g, w),
      confidence: (minRecords == null || g.entryCount < minRecords ? 'low' : 'normal') as 'normal' | 'low',
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.maxRisk - a.maxRisk ||
        b.entryCount - a.entryCount ||
        a.buildingId - b.buildingId ||
        String(a.locationText).localeCompare(String(b.locationText)),
    )
    .map((g, i) => ({ ...g, rank: i + 1 }));
}

export function monthsBetween(fromIso: string, to: Date = new Date()): number {
  const f = new Date(fromIso.replace(' ', 'T'));
  if (isNaN(f.getTime())) return 0;
  return Math.max(0, (to.getTime() - f.getTime()) / (30.4375 * 86400_000));
}
