import { test, expect } from '@playwright/test';

test('the built application warms Monaco before opening a file and creates only one document model', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false }, version: 0 })));
  // This request must happen on the welcome screen, before any editor mounts.
  const vendor = page.waitForResponse((response) => /\/assets\/monaco-vendor-.*\.js$/.test(response.url()));
  await page.goto('/');
  const vendorUrl = (await vendor).url();
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  await page.waitForFunction(async (url) => {
    const exports = await import(url);
    const monaco = Object.values(exports).find((value) => value?.editor && value?.languages);
    return monaco?.editor[Symbol.for('mokidown.monaco.shiki.runtime')]?.ready;
  }, vendorUrl);
  await page.evaluate(async (url) => {
    const exports = await import(url);
    window.monacoTrial = Object.values(exports).find((value) => value?.editor && value?.languages);
    window.modelsCreated = 0;
    window.spinnersShown = 0;
    window.modelListener = window.monacoTrial.editor.onDidCreateModel(() => { window.modelsCreated += 1; });
    window.spinnerObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('.ant-spin') || node.querySelector('.ant-spin'))) window.spinnersShown += 1;
      }
    });
    window.spinnerObserver.observe(document.querySelector('.editor-content'), { childList: true, subtree: true });
  }, vendorUrl);
  await page.locator('.moki-action--primary').click();
  await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.type('# Ready\n\n**bold**\n');
  await expect.poll(() => page.evaluate(() => window.monacoTrial.editor.getModels()[0].getValue())).toContain('**bold**');
  expect(await page.evaluate(() => {
    window.modelListener.dispose(); window.spinnerObserver.disconnect();
    return { models: window.modelsCreated, spinners: window.spinnersShown };
  })).toEqual({ models: 1, spinners: 0 });
  expect(errors).toEqual([]);
});
