import { defineConfig } from 'vitest/config';
// R20 — 원격 MariaDB 통합 테스트. 공유 DB 이므로 직렬 실행
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test', JOBS_ENABLED: '0', COOKIE_SECURE: '0', MOCK_AI_SCENARIO: '' },
  },
});
