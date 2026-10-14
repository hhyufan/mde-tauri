import { test, expect } from '@playwright/test';

/**
 * 大纲跳转的回归。
 *
 * 用户实际踩到的场景是「含链接的无序列表」：
 *   * [功能文档](docs/Function/README.md) · [语言服务](docs/语言服务.md)
 * 它同时暴露了两个问题：
 *   1. 大纲文本若保留 URL（`功能文档(docs/...)`），就与渲染出的文本
 *      （`功能文档 · 语言服务`）对不上，前缀匹配失败；
 *   2. 匹配失败后回退到编辑器节点查找，而那里把柯里化的 findChildren
 *      当成两参函数调用，拿到的是函数而非数组，`.find` 直接抛 TypeError。
 *
 * 注意 Milkdown 是懒加载的：必须等编辑器挂载后再点大纲，
 * 否则 handler 里 wrapperRef/editorRef 还是空的，跳转会被静默忽略。
 */
async function openOutlineDocument(page) {
  await page.evaluate(async () => {
    const text = [
      '# Title',
      '',
      ...Array.from({ length: 30 }, (_, i) => `- item ${i}`),
      '',
      '* [功能文档](docs/Function/README.md) · [语言服务](docs/语言服务.md)',
      '',
      '## Tail heading',
      '',
    ].join('\n');
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: cache } = await import('/src/store/useExternalDocsStore.js');
    cache.getState().put('outline', { name: 'outline.md', content: text });
    store.getState().openExternalFile({ fileId: 'outline', name: 'outline.md', content: text });
    store.getState().setActiveTab('external-outline');
    store.getState().setViewMode('preview');
    store.getState().setSidebarView('outline');
  });
  await expect(page.locator('.outline__item--heading', { hasText: 'Title' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.md-preview--milkdown')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
}

async function scrollTop(page) {
  return page.evaluate(() => document.querySelector('.md-preview--milkdown')?.scrollTop ?? -1);
}

test('outline jumps to a linked list item without throwing', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await openOutlineDocument(page);

  // 大纲标签里不应残留 URL。
  const linked = page.locator('.outline__item--list-unordered', { hasText: '功能文档' });
  await expect(linked).toBeVisible({ timeout: 15000 });
  await expect(linked).toContainText('功能文档 · 语言服务');
  await expect(linked).not.toContainText('docs/');

  expect(await scrollTop(page)).toBe(0);
  await linked.click();
  await page.waitForTimeout(1000);

  // 不再崩溃，而且真的滚过去了。
  expect(errors).toEqual([]);
  expect(await scrollTop(page)).toBeGreaterThan(0);
});

test('outline jumps to a plain list item', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await openOutlineDocument(page);

  await page.locator('.outline__item--list-unordered', { hasText: 'item 25' }).click();
  await page.waitForTimeout(1000);

  expect(errors).toEqual([]);
  expect(await scrollTop(page)).toBeGreaterThan(0);
});

test('outline still jumps to headings', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await openOutlineDocument(page);

  await page.locator('.outline__item--heading', { hasText: 'Tail heading' }).click();
  await page.waitForTimeout(1000);

  expect(errors).toEqual([]);
  expect(await scrollTop(page)).toBeGreaterThan(0);
});

test('a jump whose target is absent from the DOM falls back without throwing', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await openOutlineDocument(page);

  // 直接派发一个 DOM 中匹配不到的目标，强制走编辑器节点查找这条回退路径。
  // 这正是柯里化 bug 的爆点：修复前 findChildren 返回函数，`.find` 必然抛 TypeError。
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('outline:jump', {
      detail: { line: 9999, text: 'nowhere-in-this-document', type: 'list-unordered' },
    }));
  });
  await page.waitForTimeout(600);

  expect(errors).toEqual([]);
});
