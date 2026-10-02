import sharp from 'sharp';
import exifr from 'exifr';
import { query } from '../../db/pool';

/**
 * research R8 — G3 사진 품질 판정(AI 호출 전, 서버 로컬).
 * ① 형식 JPEG·PNG·WebP ② 짧은 변 ≥ min_short_side ③ 평균 휘도 min_luma~max_luma ④ 라플라시안 분산 ≥ min_sharpness
 */
export interface QualityRules {
  min_short_side: { threshold: number; reason: string };
  min_luma: { threshold: number; reason: string };
  max_luma: { threshold: number; reason: string };
  min_sharpness: { threshold: number; reason: string };
}

export interface QualityMetrics {
  format: string;
  width: number;
  height: number;
  luma: number;
  sharpness: number;
}

export interface QualityVerdict {
  ok: boolean;
  reason?: string;
  metrics: QualityMetrics;
  takenAt: Date | null;
}

const FORMATS = ['jpeg', 'png', 'webp'];

export async function loadRules(): Promise<QualityRules> {
  const rows = await query<{ rule_key: keyof QualityRules; threshold: number; reason_text: string }>(
    'SELECT rule_key, threshold, reason_text FROM photo_quality_rule',
  );
  const r: any = {};
  for (const row of rows) r[row.rule_key] = { threshold: Number(row.threshold), reason: row.reason_text };
  return r as QualityRules;
}

export async function measure(buf: Buffer): Promise<QualityMetrics> {
  const img = sharp(buf, { failOn: 'error' }).rotate();
  const meta = await img.metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  // 측정용 축소본(긴 변 512) — 해상도와 무관하게 비교 가능한 값
  const small = sharp(buf).rotate().resize(512, 512, { fit: 'inside' }).greyscale();
  const stats = await small.clone().stats();
  const luma = stats.channels[0].mean / 255;
  const lap = await small
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer();
  let sum = 0;
  let sq = 0;
  for (const v of lap) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / lap.length;
  const sharpness = sq / lap.length - mean * mean;
  return { format: meta.format ?? 'unknown', width, height, luma, sharpness };
}

export async function judgeQuality(buf: Buffer, rules?: QualityRules): Promise<QualityVerdict> {
  const R = rules ?? (await loadRules());
  let metrics: QualityMetrics;
  try {
    metrics = await measure(buf);
  } catch {
    return {
      ok: false,
      reason: '사진 파일을 읽을 수 없습니다 - JPEG·PNG·WebP 사진을 올려 주세요',
      metrics: { format: 'unknown', width: 0, height: 0, luma: 0, sharpness: 0 },
      takenAt: null,
    };
  }
  let takenAt: Date | null = null;
  try {
    const exif = await exifr.parse(buf, ['DateTimeOriginal']);
    if (exif?.DateTimeOriginal instanceof Date && !isNaN(exif.DateTimeOriginal.getTime())) takenAt = exif.DateTimeOriginal;
  } catch {
    /* EXIF 없음 */
  }
  const fail = (reason: string): QualityVerdict => ({ ok: false, reason, metrics, takenAt });
  if (!FORMATS.includes(metrics.format)) return fail('지원하지 않는 사진 형식입니다 - JPEG·PNG·WebP 로 올려 주세요');
  if (Math.min(metrics.width, metrics.height) < R.min_short_side.threshold) return fail(R.min_short_side.reason);
  if (metrics.luma < R.min_luma.threshold) return fail(R.min_luma.reason);
  if (metrics.luma > R.max_luma.threshold) return fail(R.max_luma.reason);
  if (metrics.sharpness < R.min_sharpness.threshold) return fail(R.min_sharpness.reason);
  return { ok: true, metrics, takenAt };
}
