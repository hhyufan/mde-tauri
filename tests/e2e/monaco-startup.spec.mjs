import { test, expect } from '@playwright/test';

test('the application prepares Monaco on the welcome screen and opens its first document without a loading spinner', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  // A cold dev server may still be transforming the application dependency graph.
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(async () => {
    const boot = await import('/src/utils/monacoRuntimeBoot.js');
    return Boolean(boot.getLoadedMonacoEditor());
  });
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    // This document exists only in the test buffer, not on the native disk.
    config.getState().setConfig('autoSave', false);
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    window.startupModels = [];
    window.startupModelListener = monaco.editor.onDidCreateModel((model) => window.startupModels.push(model.uri.toString()));
    const workspace = document.querySelector('.editor-content');
    window.startupSpinners = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('.ant-spin') || node.querySelector('.ant-spin'))) window.startupSpinners += 1;
      }
    });
    observer.observe(workspace, { childList: true, subtree: true });
    window.startupObserver = observer;
    store.getState().openFile({ path: '/startup.md', name: 'startup.md', content: '# Ready\n\n**bold**\n' });
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Ready');
  await expect(page.locator('.monaco-editor-container[aria-busy="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => { window.startupObserver.disconnect(); return window.startupSpinners; })).toBe(0);
  // The dev entry deliberately uses StrictMode's setup/cleanup/setup cycle.
  // Both mounts must create the real file, never a throwaway blank model.
  expect(await page.evaluate(() => { window.startupModelListener.dispose(); return window.startupModels; })).toEqual(['file:///startup.md', 'file:///startup.md']);
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('editable');
  await expect.poll(() => page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    return store.getState().getActiveTab()?.content;
  })).toContain('editable');
  expect(errors).toEqual([]);
});
