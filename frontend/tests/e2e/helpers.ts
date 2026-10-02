import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PASSWORD = process.env.DEMO_PASSWORD ?? readDemoPassword();
function readDemoPassword(): string {
  try {
    const env = fs.readFileSync(path.resolve(__dirname, '../../../backend/.env'), 'utf8');
    return /^SEED_DEMO_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}
export const FIXTURES = path.resolve(__dirname, '../../../backend/tests/fixtures/photos');

export async function login(page: Page, email: string, returnTo = '/') {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** 360px 가로 스크롤 없음 (SC-018) */
export async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

/** axe 접근성 — serious/critical 위반 0 */
export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}
