import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { storage } from '../../../adapters/storage';

/**
 * research R23 — 결정적 합성 사진(저작권·개인정보 없음).
 * good: 1280×960 하자 종류별 패턴 · dark · blurry · small
 */
export type PhotoKind = 'crack' | 'leak' | 'condensation';
export type PhotoQuality = 'good' | 'dark' | 'blurry' | 'small';

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function concreteNoise(w: number, h: number, seed: number, base: number, spread: number): Buffer {
  const rnd = prng(seed);
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = base + (rnd() - 0.5) * spread + Math.sin(x / 37 + y / 53) * 6;
      const i = (y * w + x) * 3;
      buf[i] = Math.max(0, Math.min(255, n + 4));
      buf[i + 1] = Math.max(0, Math.min(255, n + 2));
      buf[i + 2] = Math.max(0, Math.min(255, n));
    }
  }
  return buf;
}

function overlaySvg(kind: PhotoKind, w: number, h: number, seed: number): string {
  const rnd = prng(seed * 7 + 3);
  if (kind === 'crack') {
    let d = `M ${w * 0.18} ${h * 0.12}`;
    let x = w * 0.18;
    let y = h * 0.12;
    for (let i = 0; i < 26; i++) {
      x += w * 0.025 + rnd() * w * 0.012;
      y += h * 0.03 + (rnd() - 0.4) * h * 0.04;
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <path d="${d}" stroke="#2b2b2b" stroke-width="7" fill="none" stroke-linejoin="round"/>
      <path d="${d}" stroke="#151515" stroke-width="3" fill="none" transform="translate(2,1)"/>
      <path d="M ${w * 0.5} ${h * 0.5} l ${w * 0.08} ${h * 0.12} l ${w * 0.02} ${h * 0.1}" stroke="#2e2e2e" stroke-width="3" fill="none"/>
    </svg>`;
  }
  if (kind === 'leak') {
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="g" cx="50%" cy="20%" r="60%">
        <stop offset="0%" stop-color="#6b4a2a" stop-opacity="0.85"/>
        <stop offset="60%" stop-color="#8a6a45" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#8a6a45" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="${w * 0.5}" cy="${h * 0.25}" rx="${w * 0.32}" ry="${h * 0.22}" fill="url(#g)"/>
      <path d="M ${w * 0.47} ${h * 0.3} q 6 ${h * 0.25} -4 ${h * 0.55}" stroke="#5a3d22" stroke-width="10" fill="none" opacity="0.7"/>
      <path d="M ${w * 0.56} ${h * 0.32} q -5 ${h * 0.2} 6 ${h * 0.45}" stroke="#5a3d22" stroke-width="7" fill="none" opacity="0.6"/>
    </svg>`;
  }
  const dots = Array.from({ length: 220 }, () => {
    const cx = (rnd() * w).toFixed(0);
    const cy = (rnd() * h * 0.7).toFixed(0);
    const r = (2 + rnd() * 6).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#dfe6ea" stroke="#7d8b93" stroke-width="1.5" opacity="0.9"/>`;
  }).join('');
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="#3d4a3a" opacity="0.35"/>${dots}</svg>`;
}

export async function makePhoto(kind: PhotoKind, quality: PhotoQuality = 'good', seed = 1): Promise<Buffer> {
  const [w, h] = quality === 'small' ? [480, 360] : [1280, 960];
  const base = kind === 'condensation' ? 170 : kind === 'leak' ? 185 : 150;
  const raw = concreteNoise(w, h, seed, base, 70);
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } }).composite([
    { input: Buffer.from(overlaySvg(kind, w, h, seed)), top: 0, left: 0 },
  ]);
  let out = await img.jpeg({ quality: 88 }).toBuffer();
  if (quality === 'dark') out = await sharp(out).linear(0.07, 0).jpeg({ quality: 88 }).toBuffer();
  if (quality === 'blurry') out = await sharp(out).blur(9).jpeg({ quality: 88 }).toBuffer();
  return out;
}

/** 저장소에 넣고 storage_key 반환 */
export async function storeSeedPhoto(kind: PhotoKind, seed: number, quality: PhotoQuality = 'good'): Promise<string> {
  const key = `seed/${kind}-${quality}-${seed}.jpg`;
  if (!(await storage.exists(key))) await storage.put(key, await makePhoto(kind, quality, seed));
  return key;
}

/** 테스트·E2E 업로드용 파일 (tests/fixtures/photos) */
export async function writeFixtures(dir = path.resolve(__dirname, '../../../../tests/fixtures/photos')): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  for (const kind of ['crack', 'leak', 'condensation'] as PhotoKind[]) {
    const p = path.join(dir, `${kind}-good.jpg`);
    fs.writeFileSync(p, await makePhoto(kind, 'good', 11));
    out.push(p);
  }
  for (const q of ['dark', 'blurry', 'small'] as PhotoQuality[]) {
    const p = path.join(dir, `crack-${q}.jpg`);
    fs.writeFileSync(p, await makePhoto('crack', q, 11));
    out.push(p);
  }
  return out;
}
