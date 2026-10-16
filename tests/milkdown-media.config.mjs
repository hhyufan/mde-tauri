import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'milkdown-media.spec.mjs',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:1447',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1447',
    url: 'http://127.0.0.1:1447',
    reuseExistingServer: false,
  },
});
