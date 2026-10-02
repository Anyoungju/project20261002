import { test, expect } from '@playwright/test';
import path from 'node:path';
import { FIXTURES, login, noHorizontalScroll, axe } from './helpers';

test('US1 비회원 분석 → 결과 카드 안에 닫을 수 없는 고지', async ({ page }) => {
  await page.goto('/analysis');
  await expect(page.getByRole('heading', { name: '하자 분석' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.locator('#s2-photos').setInputFiles(path.join(FIXTURES, 'crack-good.jpg'));
  await page.getByLabel(/간단한 설명/).fill('거실 벽 균열 #normal');
  await page.getByRole('button', { name: '분석 요청' }).click();
  await expect(page.getByRole('heading', { name: '가능한 원인' })).toBeVisible({ timeout: 30_000 });
  const notice = page.getByRole('note', { name: '1차 참고용' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button')).toHaveCount(0);
  await axe(page);
});

test('US1 G3 어두운 사진 → 차단 블록 + [사진 다시 올리기]', async ({ page }) => {
  await page.goto('/analysis');
  await page.locator('#s2-photos').setInputFiles(path.join(FIXTURES, 'crack-dark.jpg'));
  await page.getByRole('button', { name: '분석 요청' }).click();
  const gate = page.locator('#gate-block');
  await expect(gate).toContainText('사진 품질이 분석에 적합하지 않아 분석할 수 없습니다');
  await expect(gate.getByRole('button', { name: '사진 다시 올리기' })).toBeVisible();
});

test('US2 체험 소진 → G2 → 이용권 구매 화면', async ({ page }) => {
  await login(page, 'general.empty@dev.local', '/analysis');
  await expect(page.getByText('분석 이용권이 없습니다 - 무료 체험을 모두 사용했습니다').first()).toBeVisible();
  await page.goto('/purchase?returnTo=/analysis');
  await expect(page.getByText('건별 유료 분석').first()).toBeVisible();
  await expect(page.getByText('월 구독').first()).toBeVisible();
  await noHorizontalScroll(page);
  await axe(page);
});
