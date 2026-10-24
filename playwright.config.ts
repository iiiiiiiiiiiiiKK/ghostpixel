import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置：使用 vite preview 提供一个接近生产环境的静态服务。
 *
 * 测试时用 BASE_PATH=/ 构建，避免 /ghostpixel/ 子路径干扰断言；
 * 生产构建默认使用 /ghostpixel/（GitHub Pages 项目页路径）。
 *
 * 两个 project 都跑 Chromium：desktop 用桌面视口，mobile 用 iPhone 视口 + 触摸，
 * 这样可以在不额外下载 WebKit 的前提下验证移动端自适应布局。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4399',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
  webServer: {
    command: 'node scripts/preview-for-e2e.mjs',
    url: 'http://127.0.0.1:4399',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
