/** 통합 테스트 표식 데이터(*@test.buildcare.local · TEST-*) 전부 정리 — 중단된 테스트 뒷정리용 */
import { cleanup } from '../tests/integration/helpers';
import { closePool, query } from '../src/db/pool';
(async () => {
  // 연결되지 않은 테스트 중 생성된 비회원 계정은 테스트 건물·사용자와 무관하므로 남겨 둔다
  await cleanup([], true);
  const left = await query("SELECT COUNT(*) AS n FROM user_account WHERE email LIKE '%@test.buildcare.local'");
  console.log(`[cleanup] 남은 테스트 계정 ${left[0].n}`);
  await closePool();
})().catch(async (e) => {
  console.error(e.message);
  await closePool();
  process.exitCode = 1;
});
