import { test, expect } from '@playwright/test';

test('packaged application resumes a saved document and keeps its viewport across reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('mokidown-session')) return;
    const content = '# Resumed document\n\n' + 'Paragraph\n\n'.repeat(120);
    localStorage.setItem('mokidown-external-docs', JSON.stringify({ state: { docs: {
      'guest::a': { fileId: 'a', ownerUserId: 'guest', name: 'a.md', content },
    } }, version: 0 }));
    localStorage.setItem('mokidown-session', JSON.stringify({ version: 1, activeTabId: 'external-a',
      tabs: [{ id: 'external-a', name: 'a.md', path: '', externalFileId: 'a', ext: 'md' }] }));
    localStorage.setItem('mokidown-editor', JSON.stringify({ state: { viewMode: 'split', sidebarVisible: false, splitRatio: 0.6 }, version: 0 }));
    localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false }, version: 0 }));
  });
  const vendor = page.waitForResponse((response) => /\/assets\/monaco-vendor-.*\.js$/.test(response.url()));
  await page.goto('/');
  const vendorUrl = (await vendor).url();
  await expect(page.locator('.md-preview h1')).toHaveText('Resumed document');
  await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
  const saved = await page.evaluate(async (url) => {
    const exports = await import(url);
    const monaco = Object.values(exports).find((value) => value?.editor && value?.languages);
    const editor = monaco.editor.getEditors()[0];
    editor.setPosition({ lineNumber: 40, column: 5 });
    editor.setScrollTop(500);
    // pagehide captures the current editor on reload; no test-only flush API.
    return { cursor: editor.getPosition(), scroll: editor.getScrollTop() };
  }, vendorUrl);
  await page.reload();
  await expect(page.locator('.md-preview h1')).toHaveText('Resumed document');
  await expect.poll(() => page.evaluate(async (url) => {
    const exports = await import(url);
    const monaco = Object.values(exports).find((value) => value?.editor && value?.languages);
    const editor = monaco.editor.getEditors()[0];
    return { cursor: editor.getPosition(), scroll: editor.getScrollTop() };
  }, vendorUrl)).toEqual(saved);
  await expect(page.locator('.editor-content__welcome')).toHaveCount(0);
});
