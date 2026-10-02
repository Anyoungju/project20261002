import { test, expect } from '@playwright/test';
import path from 'node:path';
import { FIXTURES, login } from './helpers';

/** T153 · FR-102 · SC-017 — 새로고침·세션 만료·네트워크 단절에도 입력값을 잃지 않는다 */

test('S2 새로고침 후 설명·사진 초안 복원', async ({ page }) => {
  await page.goto('/analysis');
  await page.locator('#s2-photos').setInputFiles(path.join(FIXTURES, 'crack-good.jpg'));
  await page.getByLabel(/간단한 설명/).fill('초안 보존 확인 - 거실 벽 균열');
  await expect(page.getByAltText(/미리보기/)).toHaveCount(1);
  await page.waitForTimeout(600); // 300ms 디바운스 + IndexedDB 쓰기
  await page.reload();
  await expect(page.getByLabel(/간단한 설명/)).toHaveValue('초안 보존 확인 - 거실 벽 균열');
  await expect(page.getByAltText(/미리보기/)).toHaveCount(1);
});

test('S4 세션 만료 → 로그인 → 같은 화면·입력값으로 복귀', async ({ page, context }) => {
  await login(page, 'expert@dev.local', '/verification');
  await page.goto('/verification');
  // 대기 목록 첫 건 선택
  await page.locator('.qlist li button, .qlist li a').first().click();
  await expect(page).toHaveURL(/itemId=\d+/);
  const url = page.url();
  const opinion = page.locator('#s4-opinion');
  await opinion.fill('세션 만료 전에 쓰던 의견');
  await page.waitForTimeout(600);
  // 세션 만료 흉내: 쿠키 삭제 후 화면 다시 열기
  await context.clearCookies();
  await page.goto(url);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('이메일').fill('expert@dev.local');
  const { PASSWORD } = await import('./helpers');
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/verification\?itemId=\d+/);
  await expect(page.locator('#s4-opinion')).toHaveValue('세션 만료 전에 쓰던 의견');
});

test('S2 네트워크 단절 시 입력값 유지 + [다시 시도]', async ({ page, context }) => {
  await page.goto('/analysis');
  await page.locator('#s2-photos').setInputFiles(path.join(FIXTURES, 'crack-good.jpg'));
  await page.getByLabel(/간단한 설명/).fill('오프라인 제출 시험');
  await context.setOffline(true);
  await page.getByRole('button', { name: '분석 요청' }).click();
  await expect(page.getByText('저장하지 못했습니다 - 입력한 내용은 이 기기에 남아 있습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.getByLabel(/간단한 설명/)).toHaveValue('오프라인 제출 시험');
  await expect(page.getByAltText(/미리보기/)).toHaveCount(1);
  await context.setOffline(false);
});
