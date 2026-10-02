import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// backend/.env 만 읽는다(research R3). 비밀번호는 이 파일 밖에 적지 않는다.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 은 32자 이상'),
  FILE_URL_SECRET: z.string().min(32, 'FILE_URL_SECRET 은 32자 이상'),
  COOKIE_SECURE: bool,

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD 가 비어 있습니다 — backend/.env 에 Intent-Plan.md 의 값을 넣으세요'),
  DB_NAME: z.string().min(1),
  DB_NAME_TEST: z.string().optional(),
  ALLOW_TEST_ON_DEV_DB: bool,

  AI_PROVIDER: z.enum(['mock', 'gemini']).default('mock'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  MOCK_AI_SCENARIO: z.string().optional(),
  MOCK_AI_FAIL: bool,
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().default('dev-webhook-secret'),
  BMS_PROVIDER: z.enum(['mock', 'rest']).default('mock'),
  MOCK_BMS_FAIL: bool,
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().optional(),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Buildcare AI <no-reply@buildcare.local>'),
  STORAGE_DIR: z.string().default('./storage'),
  FRONTEND_DIST: z.string().optional(),

  SEED_DEMO_PASSWORD: z.string().optional(),
  SEED_ALLOW_RESET: bool,
  AUTH_LOCK_MAX_FAILS: z.coerce.number().int().default(5),
  AUTH_LOCK_MINUTES: z.coerce.number().int().default(15),
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== '0'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // 값 자체는 출력하지 않는다
  throw new Error(`backend/.env 검증 실패\n${msg}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test' || process.env.VITEST === 'true';
export const storageRoot = path.resolve(__dirname, '../..', env.STORAGE_DIR);

/** 통합 테스트는 R20 모드: 별도 DB 우선, 같은 DB 는 ALLOW_TEST_ON_DEV_DB=1 일 때만 */
export function databaseName(): string {
  if (isTest) {
    const name = env.DB_NAME_TEST || env.DB_NAME;
    if (name === env.DB_NAME && !env.ALLOW_TEST_ON_DEV_DB) {
      throw new Error('통합 테스트가 개발 DB 를 가리킵니다. ALLOW_TEST_ON_DEV_DB=1 을 명시하세요(research R20).');
    }
    return name;
  }
  return env.DB_NAME;
}
