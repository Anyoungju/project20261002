import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPool, closePool, assertServerVersion, query, exec } from './pool';
import { splitSqlStatements } from './sqlSplitter';

export const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

/** research R4 — DELIMITER 해석 러너. 적용 이력은 schema_migration */
export async function migrate(opts: { log?: (s: string) => void } = {}): Promise<{ applied: string[]; skipped: string[] }> {
  const log = opts.log ?? console.log;
  const pool = getPool();
  const version = await assertServerVersion(pool);
  log(`[migrate] server ${version}`);

  await exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    filename   VARCHAR(200) NOT NULL,
    checksum   CHAR(64)     NOT NULL,
    applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_schema_migration PRIMARY KEY (filename))`);

  const done = new Map(
    (await query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migration')).map((r) => [
      r.filename,
      r.checksum,
    ]),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const text = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(text).digest('hex');
    const prev = done.get(file);
    if (prev) {
      if (prev !== checksum) {
        throw new Error(`[migrate] ${file} 체크섬 불일치 — 적용된 마이그레이션이 바뀌었습니다. 원본을 되돌리거나 새 파일로 추가하세요.`);
      }
      skipped.push(file);
      continue;
    }
    const statements = splitSqlStatements(text);
    log(`[migrate] ${file}: ${statements.length} statements`);
    const conn = await pool.getConnection();
    try {
      for (const [idx, sql] of statements.entries()) {
        try {
          await conn.query(sql);
        } catch (e: any) {
          throw new Error(`[migrate] ${file} #${idx + 1} 실패: ${e.message}\n${sql.slice(0, 300)}`);
        }
      }
      await conn.query('INSERT INTO schema_migration (filename, checksum) VALUES (?, ?)', [file, checksum]);
    } finally {
      conn.release();
    }
    applied.push(file);
  }
  return { applied, skipped };
}

if (require.main === module) {
  migrate()
    .then(({ applied, skipped }) => {
      console.log(`[migrate] applied: ${applied.join(', ') || '(none)'} · already: ${skipped.join(', ') || '(none)'}`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
