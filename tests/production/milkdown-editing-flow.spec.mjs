import { test, expect } from '@playwright/test';

test('packaged Milkdown continues after its last code block and accepts a new heading', async ({ page }) => {
  await page.addInitScript(() => {
    const content = '# Document\n\n```text\nlast code line\n```\n';
    localStorage.setItem('mokidown-external-docs', JSON.stringify({ state: { docs: {
      'guest::flow': { fileId: 'flow', ownerUserId: 'guest', name: 'flow.md', content },
    } }, version: 0 }));
    localStorage.setItem('mokidown-session', JSON.stringify({ version: 1, activeTabId: 'external-flow',
      tabs: [{ id: 'external-flow', name: 'flow.md', path: '', externalFileId: 'flow', ext: 'md' }] }));
    localStorage.setItem('mokidown-editor', JSON.stringify({ state: { viewMode: 'preview', sidebarVisible: false }, version: 0 }));
    localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false }, version: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.milkdown-editor h1')).toHaveText('Document');
  const code = page.locator('.cm-content');
  await expect(code).toBeVisible();
  await code.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('A paragraph after code');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('A paragraph after code');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## ');
  await page.keyboard.insertText('Following heading');
  await expect(page.locator('.milkdown-editor h2')).toHaveText('Following heading');
  await expect(code).toContainText('last code line');
});

test('packaged empty Markdown file accepts a caret and text after clicking its blank viewport', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mokidown-external-docs', JSON.stringify({ state: { docs: {
      'guest::empty': { fileId: 'empty', ownerUserId: 'guest', name: 'empty.md', content: '' },
    } }, version: 0 }));
    localStorage.setItem('mokidown-session', JSON.stringify({ version: 1, activeTabId: 'external-empty',
      tabs: [{ id: 'external-empty', name: 'empty.md', path: '', externalFileId: 'empty', ext: 'md' }] }));
    localStorage.setItem('mokidown-editor', JSON.stringify({ state: { viewMode: 'preview', sidebarVisible: false }, version: 0 }));
    localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false }, version: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.milkdown-editor')).toBeVisible();
  const box = await page.locator('.editor-content__preview').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.milkdown-editor')).toBeFocused();
  await page.keyboard.insertText('Writing starts here');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('Writing starts here');
  await expect(page.locator('.milkdown-block-exit')).toHaveCount(0);
});
