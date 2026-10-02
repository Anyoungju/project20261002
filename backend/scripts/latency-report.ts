/**
 * T151 — 성능 측정 리포트 → docs/perf.md
 * ① SC-001: 분석 요청 → 결과(analysis_result.completed_at - analysis_request.requested_at) p50/p95/최대, 60초 이내 비율
 *    (시드 데이터는 같은 시각으로 넣으므로 제외: 시드 사진 키 'seed/' 가 아닌 실제 업로드만)
 * ② API p95 < 500ms: 배포 주소에 실제 요청(로그인 후 주요 조회 API 각 20회)
 * 사용: npx tsx scripts/latency-report.ts [--base=https://p3.sumzip.com] [--email=building@dev.local]
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/config/env';
import { closePool, query } from '../src/db/pool';

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = arg('base', 'https://p3.sumzip.com');
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '-');

async function analysisLatency() {
  const rows = await query<{ sec: number }>(
    `SELECT TIMESTAMPDIFF(MICROSECOND, q.requested_at, ar.completed_at) / 1000000 AS sec
       FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id
      WHERE NOT EXISTS (SELECT 1 FROM analysis_photo p WHERE p.request_id = q.request_id AND p.storage_key LIKE 'seed/%')`,
  );
  const xs = rows.map((r) => Number(r.sec)).filter((x) => x >= 0);
  const fails = await query<{ n: number }>("SELECT COUNT(*) AS n FROM analysis_request WHERE req_status = 'failed'");
  return {
    n: xs.length,
    p50: pct(xs, 50),
    p95: pct(xs, 95),
    max: xs.length ? Math.max(...xs) : NaN,
    within60: xs.length ? xs.filter((x) => x <= 60).length / xs.length : NaN,
    failed: Number(fails[0].n),
  };
}

class Session {
  cookies = new Map<string, string>();
  async req(method: string, url: string, body?: unknown) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET') {
      headers['X-CSRF-Token'] = this.cookies.get('bc_csrf') ?? '';
      headers['Content-Type'] = 'application/json';
    }
    const t = performance.now();
    const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ms = performance.now() - t;
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      this.cookies.set(k, v);
    }
    await r.arrayBuffer();
    return { status: r.status, ms };
  }
}

async function apiLatency(email: string) {
  const s = new Session();
  await s.req('GET', '/api/auth/csrf');
  const login = await s.req('POST', '/api/auth/login', { email, password: env.SEED_DEMO_PASSWORD });
  if (login.status !== 200) throw new Error(`로그인 실패 ${login.status}`);
  const me = await fetch(BASE + '/api/buildings', { headers: { Cookie: [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }).then(
    (r) => r.json() as Promise<any[]>,
  );
  const b = me[0]?.buildingId;
  const targets = [
    '/api/auth/me',
    '/api/gates',
    '/api/buildings',
    `/api/buildings/${b}/rail`,
    `/api/buildings/${b}/history`,
    `/api/buildings/${b}/repeat-defects`,
    `/api/buildings/${b}/schedules`,
    '/api/risk-notices',
    '/api/expert-requests',
    '/api/me/notifications',
  ];
  const out: Array<{ url: string; p50: number; p95: number; ok: boolean }> = [];
  for (const u of targets) {
    const xs: number[] = [];
    let ok = true;
    for (let i = 0; i < 20; i++) {
      const r = await s.req('GET', u);
      if (r.status !== 200) ok = false;
      xs.push(r.ms);
    }
    out.push({ url: u.replace(String(b), '{id}'), p50: pct(xs, 50), p95: pct(xs, 95), ok });
  }
  return out;
}

(async () => {
  const a = await analysisLatency();
  const api = await apiLatency(arg('email', 'building@dev.local'));
  const now = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    '# 성능 측정 (T151)',
    '',
    `측정: ${now} KST · 대상 ${BASE} · AI 제공자 \`${env.AI_PROVIDER}\` · DB 원격 MariaDB(${env.DB_HOST})`,
    '',
    '## SC-001 분석 요청 → 결과',
    '',
    '> DB TIMESTAMP 는 초 단위라 1초 미만 처리는 0~1초로 기록된다.',
    '',
    '| 표본 | p50 | p95 | 최대 | 60초 이내 | 실패(G4) 누적 |',
    '|---:|---:|---:|---:|---:|---:|',
    `| ${a.n} | ${a.p50?.toFixed(1)}s | ${a.p95?.toFixed(1)}s | ${a.max?.toFixed(1)}s | ${Number.isFinite(a.within60) ? (a.within60 * 100).toFixed(0) + '%' : '-'} | ${a.failed} |`,
    '',
    env.AI_PROVIDER === 'mock'
      ? '> AI 는 mock(고정 지연 0.6초)이라 이 수치는 품질 판정·저장·DB 왕복 시간이다. Gemini 연동 후 다시 측정한다(타임아웃 45초 + 처리 여유로 60초 목표).'
      : '> Gemini 실제 호출 포함 수치.',
    '',
    '## API p95 (목표 < 500ms) — 배포 주소 경유(nginx → Node → 원격 DB), 각 20회',
    '',
    '| API | p50 (ms) | p95 (ms) | 목표 | 응답 |',
    '|---|---:|---:|:--:|:--:|',
    ...api.map((r) => `| \`GET ${r.url}\` | ${f(r.p50)} | ${f(r.p95)} | ${r.p95 < 500 ? '충족' : '**초과**'} | ${r.ok ? '200' : '오류'} |`),
    '',
    '재측정: `cd backend && npx tsx scripts/latency-report.ts`',
    '',
  ];
  const out = path.resolve(__dirname, '../docs/perf.md');
  fs.writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
  await closePool();
})().catch(async (e) => {
  console.error(e.message);
  await closePool();
  process.exitCode = 1;
});
