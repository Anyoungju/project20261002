/** npm run job:p0 | job:no-response | job:bms-sync — 배치를 한 번 수동 실행 */
import { closePool } from '../db/pool';
import { withJobLock } from './scheduler';
import { JOBS } from './index';

async function main() {
  const name = process.argv[2];
  const fn = JOBS[name];
  if (!fn) {
    console.error(`알 수 없는 작업: ${name} (가능: ${Object.keys(JOBS).join(', ')})`);
    process.exitCode = 2;
    return;
  }
  const out = await withJobLock(name, fn);
  console.log(JSON.stringify(out));
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
