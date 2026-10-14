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
  const block = await page.locator('.milkdown-code-block').boundingBox();
  await page.mouse.click(block.x + 12, block.y + block.height + 100);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
  await code.click();
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
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

test('packaged Milkdown renders Markdown after HTML and renders pasted source immediately', async ({ page }) => {
  await page.addInitScript(() => {
    const content = '<br>\n# Heading\n\n<div>HTML</div>\n$$\nx^2\n$$\n\nTail\n';
    localStorage.setItem('mokidown-external-docs', JSON.stringify({ state: { docs: {
      'guest::boundaries': { fileId: 'boundaries', ownerUserId: 'guest', name: 'boundaries.md', content },
    } }, version: 0 }));
    localStorage.setItem('mokidown-session', JSON.stringify({ version: 1, activeTabId: 'external-boundaries',
      tabs: [{ id: 'external-boundaries', name: 'boundaries.md', path: '', externalFileId: 'boundaries', ext: 'md' }] }));
    localStorage.setItem('mokidown-editor', JSON.stringify({ state: { viewMode: 'preview', sidebarVisible: false }, version: 0 }));
    localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false }, version: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.milkdown-editor h1')).toHaveText('Heading');
  await expect(page.locator('.md-preview__math--block .katex')).toBeVisible();
  await page.locator('.milkdown-editor > p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.locator('.milkdown-editor').evaluate((el) => {
    const data = new DataTransfer(); data.setData('text/plain', '## Pasted\n\n**Bold**');
    data.setData('text/html', '<pre><code>## Pasted\n\n**Bold**</code></pre>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.milkdown-editor h2')).toHaveText('Pasted');
  await expect(page.locator('.milkdown-editor strong')).toHaveText('Bold');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.milkdown-editor h2')).toHaveCount(0);
  await expect(page.locator('.milkdown-editor h1')).toHaveText('Heading');
});

test('packaged editor distinguishes a real empty paragraph from the separator after image HTML', async ({ page }) => {
  await page.addInitScript(() => {
    const content = '<p align="center">\n<img src="screenshots/main.png" width="880" alt="MokiDown 主界面" />\n</p>\n\n\n## 功能\n';
    localStorage.setItem('mokidown-external-docs', JSON.stringify({ state: { docs: {
      'guest::whitespace': { fileId: 'whitespace', ownerUserId: 'guest', name: 'whitespace.md', content },
    } }, version: 0 }));
    localStorage.setItem('mokidown-session', JSON.stringify({ version: 1, activeTabId: 'external-whitespace',
      tabs: [{ id: 'external-whitespace', name: 'whitespace.md', path: '', externalFileId: 'whitespace', ext: 'md' }] }));
    localStorage.setItem('mokidown-editor', JSON.stringify({ state: { viewMode: 'preview', sidebarVisible: false }, version: 0 }));
    localStorage.setItem('mokidown-config', JSON.stringify({ state: { autoSave: false }, version: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.md-preview__html-block img')).toHaveAttribute('alt', 'MokiDown 主界面');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
  await page.locator('.milkdown-editor > p').click(); await page.keyboard.press('Backspace');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
  // The gap caret is drawn by ::after; its widget itself has a zero-size box.
  await expect(page.locator('.ProseMirror-gapcursor')).toHaveCount(1);
  await expect(page.locator('.ProseMirror-gapcursor')).toHaveCSS('display', 'block');
  await expect(page.locator('.milkdown-editor h2')).toHaveText('功能');
  await page.locator('.md-preview__html-block').hover(); await page.locator('.md-preview__html-edit').click();
  const input = page.locator('.md-preview__html-input');
  await expect(input).toHaveCSS('padding-left', '16px');
  await input.fill('<div>新内容</div>'); await page.locator('.md-preview__html-done').click();
  await expect(page.locator('.md-preview__html-block-preview')).toHaveText('新内容');
  await expect(page.locator('.milkdown-editor h2')).toHaveText('功能');
});
