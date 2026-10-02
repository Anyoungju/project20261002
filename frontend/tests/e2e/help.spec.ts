import { test, expect } from '@playwright/test';
import { login, noHorizontalScroll, axe } from './helpers';

test('사용자 매뉴얼 — 목차·차단 안내 표(gate_def 문구)·접근성', async ({ page }) => {
  await page.goto('/manual');
  await expect(page.getByRole('heading', { level: 1, name: '사용자 매뉴얼' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '하자 사진 분석' })).toBeVisible();
  // 차단 안내 문구는 서버 gate_def 단일 원천
  await expect(page.getByText('사진 품질이 분석에 적합하지 않아 분석할 수 없습니다')).toBeVisible();
  await noHorizontalScroll(page);
  await axe(page);
});

test('매뉴얼 역할 필터 — 전문가', async ({ page }) => {
  await page.goto('/manual');
  await page.getByRole('button', { name: '전문가', exact: true }).click();
  await expect(page.getByRole('heading', { name: '전문가 검증' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '유지관리 우선순위' })).toHaveCount(0);
});

test('이용 가이드라인 — 촬영 가이드·개인정보 원칙·접근성', async ({ page }) => {
  await page.goto('/guidelines#privacy');
  await expect(page.getByRole('heading', { level: 1, name: '이용 가이드라인' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '사진 촬영 가이드' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '개인정보·자료 공유 원칙' })).toBeInViewport();
  await noHorizontalScroll(page);
  await axe(page);
});

test('화면 사용법에서 매뉴얼 해당 절로 이동', async ({ page }) => {
  await login(page, 'expert@dev.local', '/verification');
  await page.goto('/verification');
  const toggle = page.getByRole('button', { name: /이 화면 사용법/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('link', { name: /매뉴얼에서 자세히 보기/ }).click();
  await expect(page).toHaveURL(/\/manual#verify/);
  await expect(page.getByRole('heading', { name: '전문가 검증' })).toBeInViewport();
});
