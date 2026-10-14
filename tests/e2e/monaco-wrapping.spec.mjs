import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  await page.evaluate(async () => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    config.getState().setConfig('autoSave', false);
    config.getState().setConfig('wordWrap', true);
    store.getState().openFile({ path: '/wrapping.md', name: 'wrapping.md', content: '# Short text' });
    window.wrappingTrial = { store, config, monaco };
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Short text');
  await page.locator('.monaco-editor').hover();
}

async function horizontalVisible(page) {
  return page.locator('.monaco-editor .scrollbar.horizontal').evaluateAll((bars) =>
    bars.some((bar) => {
      const style = getComputedStyle(bar);
      return bar.getBoundingClientRect().height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    }));
}

test('word wrap removes the horizontal scrollbar across long lines, resizing and split view', async ({ page }) => {
  await setup(page);
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await page.evaluate(() => {
    const { store } = window.wrappingTrial;
    store.getState().replaceTabContent('/wrapping.md', { content:
      '# Wide document\n' + 'long-unbroken-identifier'.repeat(180) + '\n' + '\t'.repeat(25) + '中文🙂abc '.repeat(150) });
  });
  for (const [width, split] of [[1200, false], [900, true], [1500, true], [800, false]]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((split) => window.wrappingTrial.store.getState().setViewMode(split ? 'split' : 'edit'), split);
    await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
    await page.locator('.monaco-editor').hover();
    await expect.poll(() => horizontalVisible(page)).toBe(false);
    await expect.poll(() => page.evaluate(() => {
      const { monaco } = window.wrappingTrial;
      const editor = monaco.editor.getEditors()[0];
      return editor.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn;
    })).toBeGreaterThan(0);
  }
});

test('scrollbar hover respects Monaco visibility and wrap can still be toggled', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', false));
  // No overflow: hovering must not resurrect Monaco's invisible scrollbar.
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await page.evaluate(() => window.wrappingTrial.store.getState().replaceTabContent('/wrapping.md', { content: 'x'.repeat(4000) }));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', true));
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await page.evaluate(() => window.wrappingTrial.monaco.editor.getEditors()[0].updateOptions({ wordWrapOverride1: 'off' }));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', false));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', true));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.monaco.editor.getEditors()[0].updateOptions({ wordWrapOverride1: 'inherit' }));
  await expect.poll(() => horizontalVisible(page)).toBe(false);
});

test('historical diff wraps both panes without horizontal scrollbars', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { store } = window.wrappingTrial;
    store.getState().replaceTabContent('/wrapping.md', { content: 'current text '.repeat(180) });
    const { default: history } = await import('/src/store/useHistoryStore.js');
    history.getState().setDiff({ tabId: '/wrapping.md', timestamp: 1, content: 'historical text '.repeat(180) });
  });
  await expect(page.locator('.history-diff__editor .monaco-editor')).toHaveCount(2);
  await page.locator('.history-diff__editor').hover();
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window.wrappingTrial;
    return monaco.editor.getEditors().map((editor) => editor.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn > 0);
  })).toEqual([true, true]);
});
