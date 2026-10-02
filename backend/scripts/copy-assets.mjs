// tsc 는 .sql 을 복사하지 않는다 — 마이그레이션·시드 SQL 을 dist 로 복사
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['db/migrations', 'db/seeds']) {
  const src = path.join(root, 'src', rel);
  const dst = path.join(root, 'dist', rel);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.sql'))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log('[copy-assets] sql copied');
