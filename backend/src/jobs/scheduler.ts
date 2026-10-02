import cron from 'node-cron';
import { getPool, queryOne } from '../db/pool';

/** R13 — 프로세스 내 배치. GET_LOCK 으로 다중 인스턴스에서 단일 실행 */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const conn = await getPool().getConnection();
  try {
    const r = await queryOne<{ got: number }>('SELECT GET_LOCK(?, 0) AS got', [`buildcare:job:${name}`], conn);
    if (!r?.got) {
      console.log(`[job:${name}] 다른 인스턴스가 실행 중 — 건너뜀`);
      return null;
    }
    try {
      return await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [`buildcare:job:${name}`]);
    }
  } finally {
    conn.release();
  }
}

export type JobFn = () => Promise<unknown>;
const jobs: Array<{ name: string; spec: string; fn: JobFn }> = [];

export function registerJob(name: string, spec: string, fn: JobFn): void {
  jobs.push({ name, spec, fn });
}

export function startScheduler(): void {
  for (const j of jobs) {
    cron.schedule(
      j.spec,
      () => {
        withJobLock(j.name, j.fn).catch((e) => console.error(`[job:${j.name}]`, e.message));
      },
      { timezone: 'Asia/Seoul' },
    );
    console.log(`[jobs] ${j.name} @ ${j.spec}`);
  }
}
