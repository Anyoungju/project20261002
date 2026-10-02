import { describe, it, expect } from 'vitest';
import { rankGroups, scoreGroup, DEFAULT_WEIGHTS } from '../../src/modules/priority/priorityCalculator';

const g = (o: any) => ({
  buildingId: 1,
  locationText: 'x',
  defectTypeCode: 'leak',
  entryCount: 1,
  maxRisk: 0,
  unresolvedMonths: 0,
  openNotices: 0,
  basis: [{ recordId: 1 }],
  ...o,
});

describe('우선순위 산식 (R16)', () => {
  it('가중합', () => {
    expect(scoreGroup(g({ entryCount: 3, maxRisk: 2, unresolvedMonths: 6, openNotices: 1 }), DEFAULT_WEIGHTS)).toBe(
      3 * 3 + 2 * 2 + 1 * 2 + 2 * 1,
    );
  });
  it('미조치 기간은 12개월에서 상한', () => {
    expect(scoreGroup(g({ unresolvedMonths: 30 }))).toBe(scoreGroup(g({ unresolvedMonths: 12 })));
  });
  it('점수 내림차순 순위, 근거 없는 묶음 제외 (FR-064)', () => {
    const r = rankGroups([g({ entryCount: 1 }), g({ entryCount: 5, locationText: 'y' }), g({ entryCount: 9, basis: [] })], 2);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
    expect(r[0].locationText).toBe('y');
  });
  it('이력 수 < 최소 기준이면 신뢰도 낮음, 기준 미설정이면 항상 낮음', () => {
    expect(rankGroups([g({ entryCount: 1 })], 2)[0].confidence).toBe('low');
    expect(rankGroups([g({ entryCount: 3 })], 2)[0].confidence).toBe('normal');
    expect(rankGroups([g({ entryCount: 30 })], null)[0].confidence).toBe('low');
  });
});
