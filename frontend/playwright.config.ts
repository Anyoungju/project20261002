import { defineConfig } from '@playwright/test';
/**
 * E2E — 기본 대상은 배포 주소(p3.sumzip.com). 로컬 확인은 BASE_URL=http://localhost:5173 등으로.
 * 브라우저: Playwright 번들 Chromium (npx playwright install chromium).
 */
const baseURL = process.env.BASE_URL ?? 'https://p3.sumzip.com';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    // 시스템 Chrome 은 이 계정에서 헤드리스 실행 시 컨텍스트 종료와 함께 꺼지는 문제가 있어(키체인 OSStatus -25308)
    // Playwright 번들 Chromium 을 쓴다: npx playwright install chromium
    launchOptions: { args: ['--use-mock-keychain'] },
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
