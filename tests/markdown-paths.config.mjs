import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'markdown-path-links.spec.mjs',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:1436',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1436',
    url: 'http://127.0.0.1:1436',
    reuseExistingServer: !process.env.CI,
  },
});
