import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url)));

for (const theme of ['light', 'dark']) {
  test(`startup ${theme} theme paints original image before native reveal`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((theme) => {
      localStorage.setItem('mokidown-theme', JSON.stringify({ state: { theme } }));
      window.startupCalls = [];
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        const image = document.querySelector('.card__image');
        window.startupCalls.push({ command, args, decoded: image.complete && image.naturalWidth > 0,
          background: getComputedStyle(document.body).backgroundColor });
      } };
    }, theme);
    // Public files bypass Vite's module transform. Exercise the actual packaged CSP.
    await page.route('**/splash/index.html', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: {
        ...response.headers(), 'content-security-policy': config.app.security.csp,
      } });
    });
    try {
      await page.goto(`${baseURL}/splash/index.html`);
      await expect(page.locator('.card')).toHaveClass(/card--visible/);
      expect(await page.evaluate(() => window.startupCalls)).toEqual([{
        command: 'splash_ready', args: { dark: theme === 'dark' }, decoded: true,
        background: theme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(245, 245, 247)',
      }]);
      expect(await page.locator('.card__image').evaluate((image) => image.naturalWidth)).toBe(1586);
      expect(errors).toEqual([]);
      // Wait only for the tiny settle effect before capturing the final card.
      await page.locator('.card').evaluate(async (card) => {
        await Promise.all(card.getAnimations().map((animation) => animation.finished));
      });
      await page.screenshot({ path: testInfo.outputPath(`startup-${theme}.png`) });
    } finally {
      await context.close();
    }
  });
}
