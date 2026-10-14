import { test, expect } from '@playwright/test';

test('packaged editor wraps long lines without a horizontal scrollbar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false, wordWrap: true }, version: 0 })));
  const vendor = page.waitForResponse((response) => /\/assets\/monaco-vendor-.*\.js$/.test(response.url()));
  await page.goto('/');
  const vendorUrl = (await vendor).url();
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  await page.locator('.moki-action--primary').click();
  await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
  await page.evaluate(async (url) => {
    const exports = await import(url);
    const monaco = Object.values(exports).find((value) => value?.editor && value?.languages);
    monaco.editor.getEditors()[0].getModel().setValue('wide-identifier'.repeat(250) + '\n中文🙂abc '.repeat(100));
  }, vendorUrl);
  for (const width of [1200, 800]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('.monaco-editor').hover();
    await expect.poll(() => page.locator('.monaco-editor .scrollbar.horizontal').evaluateAll((bars) =>
      bars.some((bar) => bar.getBoundingClientRect().height > 0 && Number(getComputedStyle(bar).opacity) > 0)
    )).toBe(false);
    await expect.poll(() => page.evaluate(async (url) => {
      const exports = await import(url);
      const monaco = Object.values(exports).find((value) => value?.editor && value?.languages);
      return monaco.editor.getEditors()[0].getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn;
    }, vendorUrl)).toBeGreaterThan(0);
  }
});
