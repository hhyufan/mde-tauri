import { test, expect } from '@playwright/test';

async function loadApplication(page) {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    config.getState().setConfig('autoSave', false);
    store.getState().setViewMode('edit');
    window.editorTrial = { store, config, monaco };
  });
}

test('tab switching reuses Monaco and document models while preserving edits, undo and view state', async ({ page }) => {
  test.setTimeout(60000);
  await loadApplication(page);
  await page.evaluate(() => {
    const { store } = window.editorTrial;
    store.getState().openFile({ path: '/a.md', name: 'a.md', content: 'alpha\n' + 'line\n'.repeat(100) });
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('alpha');
  await page.evaluate(() => {
    const trial = window.editorTrial;
    trial.editor = trial.monaco.editor.getEditors()[0];
    trial.modelA = trial.editor.getModel();
    trial.editorCreates = 0; trial.modelCreates = 0;
    trial.editorListener = trial.monaco.editor.onDidCreateEditor(() => { trial.editorCreates += 1; });
    trial.modelListener = trial.monaco.editor.onDidCreateModel(() => { trial.modelCreates += 1; });
    trial.editor.pushUndoStop();
    trial.editor.executeEdits('typing', [{ range: new trial.monaco.Range(1, 6, 1, 6), text: ' edited' }]);
    trial.editor.pushUndoStop();
    trial.editor.setPosition({ lineNumber: 20, column: 3 });
    trial.editor.setScrollTop(300);
    trial.viewA = trial.editor.saveViewState();
    trial.store.getState().openFile({ path: '/b.md', name: 'b.md', content: 'beta' });
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('beta');
  expect(await page.evaluate(() => window.editorTrial.store.getState().tabRenderList.map(({ name, modified }) => [name, modified])))
    .toEqual([['a.md', true], ['b.md', false]]);
  await page.evaluate(() => { window.editorTrial.modelB = window.editorTrial.editor.getModel(); });
  for (const path of ['/a.md', '/b.md', '/a.md']) {
    await page.evaluate((id) => window.editorTrial.store.getState().setActiveTab(id), path);
    await expect.poll(() => page.evaluate(() => window.editorTrial.editor.getModel().uri.path)).toBe(path);
  }
  expect(await page.evaluate(() => {
    const t = window.editorTrial;
    return { sameEditor: t.monaco.editor.getEditors()[0] === t.editor, sameModel: t.editor.getModel() === t.modelA,
      creates: t.editorCreates, models: t.modelCreates, position: t.editor.getPosition(), scroll: t.editor.getScrollTop() };
  })).toEqual({ sameEditor: true, sameModel: true, creates: 0, models: 1, position: { lineNumber: 20, column: 3 }, scroll: 300 });
  await page.evaluate(() => window.editorTrial.editor.trigger('test', 'undo', null));
  await expect.poll(() => page.evaluate(() => window.editorTrial.store.getState().getTabContent('/a.md'))).toMatch(/^alpha\n/);
  await page.evaluate(() => window.editorTrial.store.getState().closeTab('/b.md'));
  expect(await page.evaluate(() => window.editorTrial.modelB.isDisposed())).toBe(true);
  await page.evaluate(() => window.editorTrial.store.getState().replaceTabContent('/a.md', { content: 'external update' }));
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('external update');
  expect(await page.evaluate(() => window.editorTrial.editor.getModel() === window.editorTrial.modelA)).toBe(true);
  await page.evaluate(() => {
    const t = window.editorTrial;
    t.editorListener.dispose(); t.modelListener.dispose(); t.store.getState().closeTab('/a.md');
  });
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  expect(await page.evaluate(() => window.editorTrial.monaco.editor.getModels().length)).toBe(0);
});

test('large split preview and outline share one persistent analysis worker and coalesce input bursts', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.analysisStats = { workers: 0, posts: 0 };
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.analysis = String(url).includes('markdownAnalysis.worker');
        if (this.analysis) window.analysisStats.workers += 1;
      }
      postMessage(...args) {
        if (this.analysis) window.analysisStats.posts += 1;
        return super.postMessage(...args);
      }
    };
  });
  await loadApplication(page);
  await page.evaluate(() => {
    const { store } = window.editorTrial;
    store.getState().setViewMode('split'); store.getState().setSidebarView('outline');
    const content = '# Large One\n\n' + ('Paragraph ' + 'large text '.repeat(100) + '\n\n').repeat(200) + 'Reference[^note]\n\n[^note]: Footnote text\n';
    store.getState().openFile({ path: '/large.md', name: 'large.md', content });
  });
  await expect(page.locator('.md-preview .footnotes')).toBeAttached({ timeout: 30000 });
  await expect(page.locator('.outline__text').first()).toHaveText('Large One');
  expect(await page.evaluate(() => window.analysisStats)).toEqual({ workers: 1, posts: 1 });
  await page.evaluate(() => {
    const { monaco } = window.editorTrial;
    const editor = monaco.editor.getEditors()[0];
    for (let i = 0; i < 30; i += 1) editor.executeEdits('burst', [{ range: new monaco.Range(1, 12, 1, 12), text: 'x' }]);
  });
  await expect(page.locator('.md-preview h1')).toHaveText('Large Onexxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  await expect.poll(() => page.evaluate(() => window.analysisStats.posts)).toBe(2);
  expect(await page.evaluate(() => window.analysisStats.workers)).toBe(1);
});

test('Milkdown prose input does not rescan unrelated HTML, math and images', async ({ page }) => {
  await page.goto('/tests/preview-harness.html?renderer=milkdown');
  const paragraph = page.locator('.milkdown-editor > p').first();
  await expect(paragraph).toBeVisible();
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const root = document.querySelector('.md-preview--milkdown');
    const query = root.querySelectorAll.bind(root);
    window.enhancementScans = 0;
    root.querySelectorAll = (selector) => {
      if (selector.includes('data-type=') || selector === 'img[src]') window.enhancementScans += 1;
      return query(selector);
    };
  });
  await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type(' plain typing', { delay: 10 });
  await expect(paragraph).toContainText('plain typing');
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  expect(await page.evaluate(() => window.enhancementScans)).toBe(0);
});
