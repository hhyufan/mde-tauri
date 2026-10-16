import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './installer',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:1424',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    viewport: { width: 960, height: 660 },
  },
  webServer: {
    command: 'npm run installer:dev -- --host 127.0.0.1 --port 1424',
    url: 'http://127.0.0.1:1424',
    reuseExistingServer: !process.env.CI,
  },
});
