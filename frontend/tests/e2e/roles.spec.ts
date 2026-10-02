import { test, expect } from '@playwright/test';
import { login, noHorizontalScroll, axe } from './helpers';

/** 역할별 진입 화면 렌더 · 360px 가로 스크롤 없음 · 접근성 (SC-016 · SC-018) */
const cases: Array<[string, string, RegExp]> = [
  ['facility@dev.local', '/me/assignments', /내 배정 점검/],
  ['facility@dev.local', '/records', /현장 기록/],
  ['expert@dev.local', '/verification', /전문가 검증/],
  ['expert@dev.local', '/expert-inbox', /점검 요청/],
  ['building@dev.local', '/buildings/history', /건물.*이력/],
  ['building@dev.local', '/schedules', /정기점검/],
  ['building@dev.local', '/expert-requests', /전문가/],
  ['enterprise@dev.local', '/org/priority', /우선순위/],
  ['operator@dev.local', '/admin/users', /계정/],
];
for (const [email, url, heading] of cases) {
  test(`${email} ${url}`, async ({ page }) => {
    await login(page, email, url);
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading);
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page);
    await axe(page);
  });
}

test('권한 밖 화면 직접 접근 → 같은 URL 에 G0 + [권한 요청 보내기] (FR-003)', async ({ page }) => {
  await login(page, 'general@dev.local', '/analysis');
  await page.goto('/verification');
  await expect(page).toHaveURL(/\/verification/);
  await expect(page.getByText('이 화면을 볼 권한이 없습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '권한 요청 보내기' })).toBeVisible();
});

test('라이선스 만료 기업 → G0 (US6)', async ({ page }) => {
  await login(page, 'enterprise.ss@dev.local', '/org/priority');
  await page.goto('/org/priority');
  await expect(page.getByText('기업 라이선스가 만료되었습니다').first()).toBeVisible();
});
