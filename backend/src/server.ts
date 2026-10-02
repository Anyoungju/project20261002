import { env } from './config/env';
import { assertServerVersion, getPool } from './db/pool';
import { createApp } from './app';
import { loadGateDefs } from './gates/gateBlock';
import { verifyCatalog } from './auth/rbacService';
import { registerAllJobs } from './jobs';
import { startScheduler } from './jobs/scheduler';
import { recoverStuckAnalyses } from './modules/analysis/analysisService';

async function main() {
  const v = await assertServerVersion(getPool());
  console.log(`[server] MariaDB ${v} · DB ${env.DB_NAME}`);
  await loadGateDefs();
  await verifyCatalog();
  await recoverStuckAnalyses();
  const app = createApp();
  app.listen(env.PORT, () => console.log(`[server] listening :${env.PORT} (${env.NODE_ENV})`));
  if (env.JOBS_ENABLED) {
    registerAllJobs();
    startScheduler();
  }
}

main().catch((e) => {
  console.error('[server] 기동 실패:', e.message);
  process.exit(1);
});
