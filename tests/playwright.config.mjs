import { defineConfig } from '@playwright/test';

// 快捷键验证用的最小 Playwright 配置：只跑 tests/e2e 下的用例，并复用本机已安装
// 的 Edge，避免额外下载浏览器内核。
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:1431', browserName: 'chromium', channel: 'msedge', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1431',
    url: 'http://127.0.0.1:1431',
    reuseExistingServer: !process.env.CI,
  },
});
