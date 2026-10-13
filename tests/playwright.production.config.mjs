import { defineConfig } from '@playwright/test';

// Run after npm run build: the startup dependency graph differs from Vite dev.
export default defineConfig({
  testDir: './production',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:1432', browserName: 'chromium', channel: 'msedge', headless: true },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 1432 --strictPort',
    url: 'http://127.0.0.1:1432',
    reuseExistingServer: !process.env.CI,
  },
});
