/**
 * npm run db:check — 접속·버전·권한·기존 객체 확인(tasks T018). 비밀번호는 출력하지 않는다.
 * schema_migration 없이 다른 객체가 있으면 종료 코드 2 로 멈춘다(임의 DROP 금지).
 */
import { env, databaseName } from '../src/config/env';
import { getPool, closePool, assertServerVersion, query, queryOne } from '../src/db/pool';

async function main() {
  const db = databaseName();
  console.log(`[db:check] target ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${db}`);
  const pool = getPool();
  const version = await assertServerVersion(pool);
  console.log(`[db:check] version ${version}`);

  const grants = await query<Record<string, string>>('SHOW GRANTS');
  const grantLines = grants.map((g) => Object.values(g)[0]);
  for (const g of grantLines) console.log(`[db:check] grant ${g.replace(/IDENTIFIED BY .*/i, 'IDENTIFIED BY ***')}`);
  const canCreateDb = grantLines.some((g) => /ON \*\.\*/.test(g) && /(ALL PRIVILEGES|CREATE)/.test(g));
  console.log(
    `[db:check] test DB mode: ${canCreateDb ? '1 (별도 테스트 DB 생성 가능)' : '2 (같은 DB + 표식 데이터, ALLOW_TEST_ON_DEV_DB=1)'}`,
  );

  const objects = await query<{ table_type: string; n: number }>(
    `SELECT table_type, COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? GROUP BY table_type`,
    [db],
  );
  const triggers = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = ?', [db]);
  const tables = objects.find((o) => o.table_type === 'BASE TABLE')?.n ?? 0;
  const views = objects.find((o) => o.table_type === 'VIEW')?.n ?? 0;
  console.log(`[db:check] objects tables=${tables} views=${views} triggers=${triggers?.n ?? 0}`);

  const hasMigration = await queryOne(
    `SELECT 1 AS x FROM information_schema.tables WHERE table_schema = ? AND table_name = 'schema_migration'`,
    [db],
  );
  if (!hasMigration && tables + views > 0) {
    const names = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
      [db],
    );
    console.error(`[db:check] 이 DB 에 마이그레이션 이력 없이 기존 객체가 있습니다: ${names.map((r) => r.table_name).join(', ')}`);
    console.error('[db:check] 중단합니다. 사용자 확인 후 진행하세요(임의 DROP 금지).');
    process.exitCode = 2;
    return;
  }
  if (hasMigration) {
    const rows = await query<{ filename: string; applied_at: string }>(
      'SELECT filename, applied_at FROM schema_migration ORDER BY filename',
    );
    for (const r of rows) console.log(`[db:check] migration ${r.filename} @ ${r.applied_at}`);
  }
  console.log('[db:check] OK');
}

main()
  .catch((e) => {
    console.error(`[db:check] 실패: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
