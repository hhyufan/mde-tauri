import { test, expect } from '@playwright/test';

async function prepare(page, mode = 'edit') {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  await page.evaluate(async (mode) => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: cache } = await import('/src/store/useExternalDocsStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('autoSave', false);
    config.getState().setConfig('previewZoomSync', false);
    const text = '# Document A\n\n' + Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with some text.\n\n`).join('');
    cache.getState().put('a', { name: 'a.md', content: text });
    cache.getState().put('b', { name: 'b.md', content: '# Document B' });
    store.getState().openExternalFile({ fileId: 'a', name: 'a.md', content: text });
    store.getState().openExternalFile({ fileId: 'b', name: 'b.md', content: '# Document B' });
    store.getState().setActiveTab('external-a');
    store.getState().setViewMode(mode);
    store.getState().setSidebarView('outline');
    store.getState().setToolbarVisible(true);
    window.sessionTrial = { store, cache };
  }, mode);
}

test('reload restores ordered tabs, active document, layout and Monaco cursor/scroll', async ({ page }) => {
  await prepare(page, 'split');
  await expect(page.locator('.md-preview h1')).toHaveText('Document A');
  const before = await page.evaluate(async () => {
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const editor = monaco.editor.getEditors()[0];
    editor.setPosition({ lineNumber: 40, column: 5 });
    editor.setScrollTop(500);
    const preview = document.querySelector('.md-preview');
    preview.scrollTop = 600;
    const { flushEditorSession } = await import('/src/services/editorSession.js');
    flushEditorSession();
    return { cursor: editor.getPosition(), scroll: editor.getScrollTop(), preview: preview.scrollTop };
  });
  await page.reload();
  await expect(page.locator('.md-preview h1')).toHaveText('Document A');
  await expect.poll(() => page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const state = store.getState();
    return { tabs: state.tabRenderList.map((tab) => tab.id), active: state.activeTabId,
      mode: state.viewMode, sidebar: state.sidebarView, toolbar: state.toolbarVisible };
  })).toEqual({ tabs: ['external-a', 'external-b'], active: 'external-a', mode: 'split', sidebar: 'outline', toolbar: true });
  await expect.poll(() => page.evaluate(async () => {
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const editor = monaco.editor.getEditors()[0];
    return { cursor: editor.getPosition(), scroll: editor.getScrollTop(), preview: document.querySelector('.md-preview').scrollTop };
  })).toEqual(before);
  // Closing a tab is persisted immediately; it must never reappear on reload.
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().closeTab('external-b');
  });
  await page.reload();
  await expect(page.locator('.md-preview h1')).toHaveText('Document A');
  expect(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    return store.getState().tabRenderList.map((tab) => tab.id);
  })).toEqual(['external-a']);
});

test('reload restores Milkdown selection and viewport', async ({ page }) => {
  await prepare(page, 'preview');
  await expect(page.locator('.milkdown-editor > p').first()).toBeVisible();
  await page.locator('.milkdown-editor > p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const before = await page.evaluate(async () => {
    const selection = window.getSelection();
    const scroll = document.querySelector('.md-preview--milkdown');
    scroll.scrollTop = 600;
    const { flushEditorSession } = await import('/src/services/editorSession.js');
    flushEditorSession();
    return { text: selection.toString(), anchor: selection.anchorOffset, head: selection.focusOffset, top: scroll.scrollTop };
  });
  await page.reload();
  await expect(page.locator('.md-preview--milkdown')).not.toHaveClass(/md-preview--stale/);
  await page.locator('.milkdown-editor').evaluate((element) => element.focus({ preventScroll: true }));
  await expect.poll(() => page.evaluate(() => {
    const selection = window.getSelection();
    return { text: selection.toString(), anchor: selection.anchorOffset, head: selection.focusOffset,
      top: document.querySelector('.md-preview--milkdown').scrollTop };
  })).toEqual(before);
});
