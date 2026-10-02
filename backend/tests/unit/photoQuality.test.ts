import { describe, it, expect } from 'vitest';
import { judgeQuality, QualityRules } from '../../src/adapters/photoQuality/sharpQuality';
import { makePhoto } from '../../src/db/seeds/lib/photoFactory';

const rules: QualityRules = {
  min_short_side: { threshold: 640, reason: 'small' },
  min_luma: { threshold: 0.08, reason: 'dark' },
  max_luma: { threshold: 0.92, reason: 'bright' },
  min_sharpness: { threshold: 20, reason: 'blurry' },
};

describe('사진 품질 G3 (R8) — AI 호출 전 판정', () => {
  it.each(['crack', 'leak', 'condensation'] as const)('%s 정상 사진 통과', async (k) => {
    expect((await judgeQuality(await makePhoto(k, 'good', 3), rules)).ok).toBe(true);
  });
  it.each([
    ['dark', 'dark'],
    ['blurry', 'blurry'],
    ['small', 'small'],
  ] as const)('%s → %s', async (q, reason) => {
    const v = await judgeQuality(await makePhoto('leak', q, 3), rules);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe(reason);
  });
  it('이미지가 아니면 부적합', async () => {
    expect((await judgeQuality(Buffer.from('not an image'), rules)).ok).toBe(false);
  });
});
