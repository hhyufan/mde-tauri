import { expect, test } from '@playwright/test';

test('accepts dot-path completions and Ctrl-clicks sibling, parent and encoded files into real tabs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const { completionItem } = await import('/src/services/monacoLsp.js');
    const paths = await import('/src/services/markdownLspPaths.js');
    config.getState().setConfig('autoSave', false);
    const reads = [];
    let callback = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++callback,
      unregisterCallback() {},
      invoke: async (command, args) => {
        if (command === 'read_file_content') {
          reads.push(args.path);
          return { success: true, content: '# Opened target', encoding: 'UTF-8' };
        }
        if (command.startsWith('plugin:event|')) return 1;
        return [];
      },
    };
    const document = { uri: 'file:///C:/notes/sub/main.md', rootUri: 'file:///C:/notes' };
    const directory = async () => [
      { name: 'notes.md', is_dir: false },
      { name: 'parent.md', is_dir: false },
      { name: '中文 #笔记.md', is_dir: false },
      { name: 'child', is_dir: true },
    ];
    monaco.languages.registerCompletionItemProvider('markdown', {
      triggerCharacters: ['.', '/'],
      async provideCompletionItems(model, position) {
        const context = paths.markdownLinkContext(model, position);
        const items = await paths.markdownDirectoryItems(context, document, directory);
        return { suggestions: items.map((item) => completionItem(monaco, model, position, item)) };
      },
    });
    monaco.languages.registerLinkProvider('markdown', {
      provideLinks: (model) => ({
        links: paths.markdownDocumentLinks(model.getValue(), document.uri),
      }),
    });
    store
      .getState()
      .openFile({ path: 'C:/notes/sub/main.md', name: 'main.md', content: '[Read](./)' });
    window.pathTrial = { store, monaco, reads };
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('[Read]');
  for (const [prefix, expected, path] of [
    ['./', './notes.md', 'c:/notes/sub/notes.md'],
    ['../', '../parent.md', 'c:/notes/parent.md'],
    ['./中', './%E4%B8%AD%E6%96%87%20%23%E7%AC%94%E8%AE%B0.md', 'c:/notes/sub/中文 #笔记.md'],
  ]) {
    await page.evaluate(() => window.pathTrial.store.getState().setActiveTab('C:/notes/sub/main.md'));
    await expect.poll(() => page.evaluate(() => window.pathTrial.monaco.editor.getEditors()[0].getModel().uri.fsPath.replace(/\\/g, '/').toLowerCase())).toBe('c:/notes/sub/main.md');
    await page.evaluate(
      ({ prefix }) => {
        const editor = window.pathTrial.monaco.editor.getEditors()[0];
        window.pathTrial.editor = editor;
        editor.setValue(`[Read](${prefix})`);
        editor.setPosition({ lineNumber: 1, column: 8 + prefix.length });
        editor.focus();
        editor.trigger('test', 'editor.action.triggerSuggest', {});
      },
      { prefix },
    );
    const label = decodeURIComponent(expected);
    const option = page
      .locator('.suggest-widget .monaco-list-row')
      .filter({ hasText: label })
      .first();
    await expect(option).toBeVisible();
    await option.dblclick();
    await expect
      .poll(() => page.evaluate(() => window.pathTrial.editor.getValue()))
      .toBe(`[Read](${expected})`);
    await expect(page.locator('.monaco-editor .detected-link').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      window.pathTrial.editor.getContribution('editor.linkDetector')
        .getLinkOccurrence({ lineNumber: 1, column: 10 })?.link?.url?.toString().toLowerCase(),
    )).toBe(new URL(expected, 'file:///C:/notes/sub/main.md').href.toLowerCase());
    const click = await page.evaluate(() => {
      const editor = window.pathTrial.editor;
      const at = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 10 });
      const bounds = editor.getDomNode().getBoundingClientRect();
      return { x: bounds.x + at.left + 2, y: bounds.y + at.top + at.height / 2 };
    });
    await page.keyboard.down('Control');
    await page.mouse.move(click.x, click.y);
    await expect(page.locator('.monaco-editor .detected-link-active').first()).toBeVisible();
    await page.mouse.click(click.x, click.y);
    await page.keyboard.up('Control');
    await expect
      .poll(() =>
        page.evaluate(() => window.pathTrial.reads.at(-1)?.replace(/\\/g, '/').toLowerCase()),
      )
      .toBe(path.toLowerCase());
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.pathTrial.store
              .getState()
              .tabs.find((tab) => tab.id === window.pathTrial.store.getState().activeTabId)?.name,
        ),
      )
      .toBe(path.split('/').at(-1));
  }
});
