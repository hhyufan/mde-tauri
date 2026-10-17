import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['editor-controls.spec.mjs', 'milkdown-media.spec.mjs'],
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:1448',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1448',
    url: 'http://127.0.0.1:1448',
    reuseExistingServer: false,
  },
});
