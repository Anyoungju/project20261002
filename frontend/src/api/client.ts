/**
 * fetch 래퍼 (T046) — CSRF 이중 제출 · Idempotency-Key · GateBlock 파싱 · 401 복귀 · 네트워크 오류 구분.
 * 화면은 GateBlockError 를 받아 C2 블록으로 그린다(토스트·모달 금지).
 */
export interface GateAction {
  id: string;
  label: string;
  href?: string;
}
export interface GateBlock {
  gate: string;
  message: string;
  reason?: string;
  releaseParty: string;
  selfRelease: boolean;
  actions: GateAction[];
  missingFields?: string[];
  gateEventId?: number;
}

export class GateBlockError extends Error {
  constructor(
    public block: GateBlock,
    public status: number,
  ) {
    super(block.message);
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: any,
  ) {
    super(message);
  }
}
export class NetworkError extends Error {
  constructor() {
    super('네트워크에 연결할 수 없습니다');
  }
}

export function isGateBlock(x: any): x is GateBlock {
  return !!x && typeof x === 'object' && typeof x.gate === 'string' && typeof x.message === 'string' && Array.isArray(x.actions);
}

let csrfToken: string | null = null;

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  csrfToken = readCookie('bc_csrf') ?? csrfToken;
  if (csrfToken) return csrfToken;
  const r = await fetch('/api/auth/csrf', { credentials: 'include' });
  const j = await r.json();
  csrfToken = j.token;
  return csrfToken!;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Handler401 = (block: GateBlock | null) => void;
let on401: Handler401 | null = null;
export function setUnauthorizedHandler(fn: Handler401) {
  on401 = fn;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  /** true 면 401 을 전역 처리(로그인 이동)하지 않고 호출자에게 넘긴다 */
  handle401?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method ?? (opts.body || opts.form ? 'POST' : 'GET')).toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = await ensureCsrf();
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let url = path;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  let resp: Response;
  try {
    resp = await fetch(url, { method, headers, body, credentials: 'include' });
  } catch {
    throw new NetworkError();
  }
  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (resp.status === 403 && data?.code === 'csrf') {
    // 토큰 갱신 후 1회 재시도
    csrfToken = null;
    document.cookie = 'bc_csrf=; Max-Age=0; path=/';
    if (!(opts as any)._retried) return api<T>(path, { ...opts, _retried: true } as any);
  }
  if (resp.ok) {
    // G7 처럼 200 + blocked 인 응답은 호출자가 판단
    return data as T;
  }
  if (resp.status === 401 && !opts.handle401) {
    on401?.(isGateBlock(data) ? data : null);
  }
  if (isGateBlock(data)) throw new GateBlockError(data, resp.status);
  if (data && isGateBlock(data.gate)) throw new GateBlockError(data.gate, resp.status);
  throw new ApiError(resp.status, data?.code ?? 'error', data?.message ?? '요청을 처리하지 못했습니다', data);
}

export const get = <T = any>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown, extra: Partial<RequestOptions> = {}) =>
  api<T>(path, { method: 'POST', body: body ?? {}, ...extra });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string, query?: RequestOptions['query']) => api<T>(path, { method: 'DELETE', query });

/**
 * 업로드 전 사진 축소(긴 변 1600px JPEG) — p1.sumzip.com nginx 기본 본문 한도(1MB) 안에 들도록.
 * 짧은 변 640px 미만으로 줄이지는 않는다(G3 판정은 서버가 원본 비율로 한다).
 */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000) return file;
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    let q = quality;
    let blob: Blob | null = null;
    for (let i = 0; i < 4; i++) {
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size < 900_000) break;
      q -= 0.12;
    }
    return blob ?? file;
  } catch {
    return file;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof GateBlockError) return e.block.message;
  if (e instanceof NetworkError) return '네트워크에 연결할 수 없습니다 - 연결을 확인하고 다시 시도해 주세요';
  if (e instanceof ApiError) return e.message;
  return '요청을 처리하지 못했습니다';
}
