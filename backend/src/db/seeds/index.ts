/**
 * npm run db:seed:dev [-- --reset] [-- --only=us1,us3]
 * research R23 — 스토리를 바로 체험할 수 있는 시연 데이터. 운영 환경 거부, --reset 은 SEED_ALLOW_RESET=1 일 때만.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, databaseName } from '../../config/env';
import { closePool, exec, getPool, queryOne } from '../pool';
import { splitSqlStatements } from '../sqlSplitter';
import { SeedContext } from './lib/seedContext';
import { writeFixtures } from './lib/photoFactory';
import { seedBase } from './base';
import { seedUs1, seedUs2, seedRbac, seedUs3, seedUs4, seedUs5, seedUs7, seedUs8, seedUs6 } from './stories';
import { invalidateAll } from '../../auth/rbacService';

/** FK 역순 — 기준 데이터(gate_def·service_constant·notice_text·코드·요금제)·schema_migration·rbac 카탈로그는 보존 */
export const BUSINESS_TABLES_IN_DELETE_ORDER = [
  'expert_connection',
  'expert_request_attempt',
  'share_consent',
  'expert_request',
  'risk_notice',
  'priority_item_basis',
  'priority_item',
  'priority_run',
  'gate_event',
  'schedule_alert',
  'inspection_schedule',
  'data_request',
  'expert_verdict',
  'verification_item',
  'record_repair_log',
  'inspection_record_risk',
  'record_photo',
  'inspection_record',
  'analysis_action',
  'analysis_cause',
  'analysis_result',
  'analysis_photo',
  'analysis_request',
  'defect_case',
  'entitlement',
  'payment',
  'external_history',
  'bms_sync_run',
  'expert_availability',
  'expert_specialty',
  'notification',
  'permission_request',
  'rbac_audit_log',
  'auth_login_attempt',
  'idempotency_record',
  'guest_device',
  'building_access',
  'user_system_role',
  'user_credential',
  'user_role',
  'user_account',
  'building',
  'organization',
  'case_no_seq',
];

async function reset() {
  if (!env.SEED_ALLOW_RESET) throw new Error('--reset 은 SEED_ALLOW_RESET=1 일 때만 실행합니다');
  for (const t of BUSINESS_TABLES_IN_DELETE_ORDER) await exec(`DELETE FROM ${t}`);
  console.log(`[seed] 업무 테이블 ${BUSINESS_TABLES_IN_DELETE_ORDER.length}개 비움`);
}

async function main() {
  const args = process.argv.slice(2);
  const doReset = args.includes('--reset');
  const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice(7)
    .split(',')
    .map((s) => s.trim());
  const want = (k: string) => !only || only.includes(k);
  console.log(`[seed] 대상 DB: ${env.DB_HOST}:${env.DB_PORT}/${databaseName()}`);
  getPool();

  if (doReset) await reset();
  const existing = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM user_account WHERE email LIKE '%@dev.local'");
  const ctx = new SeedContext();
  const sql = fs.readFileSync(path.resolve(__dirname, 'dev_constants.sql'), 'utf8');
  for (const s of splitSqlStatements(sql)) await exec(s);
  await writeFixtures();

  if (Number(existing?.n) > 0) {
    console.log('[seed] 시연 계정이 이미 있습니다. 다시 만들려면 --reset (SEED_ALLOW_RESET=1) 을 붙이세요.');
    await ctx.loadRegistry();
    return;
  }
  await seedBase(ctx);
  const us1 = want('us1') ? await seedUs1(ctx) : null;
  if (want('us2')) await seedUs2(ctx);
  if (want('rbac')) await seedRbac(ctx);
  const us3 = want('us3') ? await seedUs3(ctx, us1) : null;
  const us4 = want('us4') ? await seedUs4(ctx) : null;
  if (want('us5')) await seedUs5(ctx);
  if (want('us7') && us3) await seedUs7(ctx, us3);
  if (want('us8')) await seedUs8(ctx, { verdictCaseId: us4?.verdictCaseId ?? null });
  if (want('us6')) await seedUs6(ctx);
  invalidateAll();

  console.log('\n[seed] 완료');
  for (const l of ctx.log) console.log(`  · ${l}`);
  console.log(
    `\n[seed] 시연 계정 (비밀번호: ${ctx.passwordGenerated ? ctx.password + '  ← 이번 실행에서 생성, 다시 표시되지 않음' : '.env 의 SEED_DEMO_PASSWORD'})`,
  );
  const rows: Array<[string, string, string]> = [
    ['(비회원)', '-', 'US1 무료 체험 3회 — 시크릿 창'],
    ['general@dev.local', '일반 사용자', 'US1 결과 이력 · 체험 1회 남음'],
    ['general.empty@dev.local', '일반 사용자', 'US2 체험 소진 → 이용권 구매'],
    ['general.expired@dev.local', '일반 사용자', 'US2 만료 구독 → G2'],
    ['facility@dev.local', '시설관리자', 'US3 현장 기록 · US4 자료 요청 · US7 내 배정 점검'],
    ['facility.c@dev.local', '시설관리자', 'RBAC 권한 요청 대기(BLD-A)'],
    ['building@dev.local', '건물관리자', 'US5 건물 이력 · US7 정기점검 · US8 전문가 연결'],
    ['lead@dev.local', '시설+건물관리자', 'RBAC 다중 역할 메뉴'],
    ['enterprise@dev.local', '기업 관리자', 'US6 우선순위 · 조직 권한 부여'],
    ['enterprise.ss@dev.local', '기업 관리자', 'US6 라이선스 만료 G0'],
    ['expert@dev.local', '전문가', 'US4 검증 · US8 요청 수락'],
    ['expert.arch@dev.local', '전문가', 'US8 거절 이력'],
    ['expert.busy@dev.local', '전문가', 'US8 G8 (가능일 없음)'],
    ['operator@dev.local', '운영자', 'RBAC 관리 · 기준값 · 고지'],
    ['disabled@dev.local', '일반 사용자', 'RBAC 비활성 — 로그인 거부'],
  ];
  for (const [e, r, s] of rows) console.log(`  ${e.padEnd(28)} ${r.padEnd(10)} ${s}`);
}

main()
  .catch((e) => {
    console.error('[seed] 실패:', e.message);
    if (e.sql) console.error(e.sql.slice(0, 300));
    process.exitCode = 1;
  })
  .finally(() => closePool());
