import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'dialog.spec.mjs', workers: 1,
  use: { baseURL: 'http://127.0.0.1:1450', channel: 'msedge', headless: true, viewport: { width: 1280, height: 850 } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 1450', url: 'http://127.0.0.1:1450', reuseExistingServer: false },
});
