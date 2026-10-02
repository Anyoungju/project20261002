// 001_buildcare_ddl.sql 이 Design/buildcare_ddl.sql 과 바이트 동일한지 확인 (T015 — DDL 수정 금지)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const h = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a = h(path.resolve(here, '../../Design/buildcare_ddl.sql'));
const b = h(path.resolve(here, '../src/db/migrations/001_buildcare_ddl.sql'));
if (a !== b) {
  console.error('[verify-ddl-copy] 001 마이그레이션이 Design/buildcare_ddl.sql 과 다릅니다');
  process.exit(1);
}
console.log(`[verify-ddl-copy] OK ${a.slice(0, 12)}`);
