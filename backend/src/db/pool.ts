import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env, databaseName } from '../config/env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: databaseName(),
      connectionLimit: 10,
      connectTimeout: 10_000,
      dateStrings: true,
      timezone: '+09:00',
      charset: 'utf8mb4',
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
    // 세션 시간대를 서울로 고정 — CURRENT_DATE 기반 뷰(v_schedule_status)가 사용자 체감 날짜와 맞도록
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+09:00'");
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type Db = Pool | PoolConnection;
export type Row = RowDataPacket & Record<string, any>;

export async function query<T = Row>(sql: string, params: unknown[] = [], db: Db = getPool()): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function queryOne<T = Row>(sql: string, params: unknown[] = [], db: Db = getPool()): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function exec(sql: string, params: unknown[] = [], db: Db = getPool()): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(sql, params);
  return res;
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}

/** research R3: MariaDB 10.6 이상, 설계 검증 12.0 */
export async function assertServerVersion(db: Db = getPool()): Promise<string> {
  const row = await queryOne<{ v: string }>('SELECT VERSION() AS v', [], db);
  const v = row?.v ?? '';
  if (!/mariadb/i.test(v)) throw new Error(`MariaDB 가 아닙니다: ${v}`);
  const [maj, min] = v.split('.').map((x) => parseInt(x, 10));
  if (maj < 10 || (maj === 10 && min < 6)) throw new Error(`MariaDB 10.6 이상이 필요합니다: ${v}`);
  if (maj !== 12) console.warn(`[db] 설계 검증 버전(12.0)과 다릅니다: ${v}`);
  return v;
}
