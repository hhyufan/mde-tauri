import { test, expect } from '@playwright/test';

/** 浏览器里没有 Tauri：装一份最小实现，让本地历史按真实路径列出记录。 */
function installHistory() {
  const now = Date.now();
  const entries = Array.from({ length: 12 }, (_, i) => ({
    timestamp: now - i * 3600_000,
    bytes: 1024 * (i + 1),
  }));
  let callbackId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => ++callbackId, unregisterCallback() {},
    invoke: async (command) => {
      if (command === 'history_list') return entries;
      if (command === 'history_read') return 'older';
      if (command.startsWith('plugin:event|')) return 1;
      if (['list_language_plugins', 'get_cli_args', 'get_directory_contents'].includes(command)) return [];
      if (command === 'get_refresh_credential') return null;
      if (command.includes('is_')) return false;
      return true;
    },
  };
}

test('local history docks at the sidebar bottom, starts collapsed, and pages at six rows', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(installHistory);
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/timeline.md', name: 'timeline.md', content: '# Hi\n' });
  });

  const timeline = page.locator('.timeline');
  await expect(timeline).toBeVisible({ timeout: 15000 });

  // 默认收起：只留标题一行，列表不渲染。
  await expect(page.locator('.timeline__toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.timeline__item')).toHaveCount(0);

  // 贴在侧边栏视图底部，宽度与视图一致（不随文件树内容变化）。
  const [timelineBox, viewBox] = await Promise.all([
    timeline.boundingBox(),
    page.locator('.sidebar__view').boundingBox(),
  ]);
  expect(Math.round(timelineBox.y + timelineBox.height)).toBe(Math.round(viewBox.y + viewBox.height));
  expect(Math.round(timelineBox.width)).toBe(Math.round(viewBox.width));

  // 展开：恰好 6 行，第 7 条起滚动。
  await page.locator('.timeline__toggle').click();
  await expect(page.locator('.timeline__item')).toHaveCount(12);
  const metrics = await page.evaluate(() => {
    const list = document.querySelector('.timeline__list');
    const item = document.querySelector('.timeline__item');
    return {
      listHeight: Math.round(list.getBoundingClientRect().height),
      rowHeight: Math.round(item.getBoundingClientRect().height),
      scrollable: list.scrollHeight > list.clientHeight,
    };
  });
  expect(metrics.listHeight).toBe(metrics.rowHeight * 6);
  expect(metrics.scrollable).toBe(true);

  // 收起后重新贴底。
  await page.locator('.timeline__toggle').click();
  const collapsedBox = await timeline.boundingBox();
  expect(Math.round(collapsedBox.y + collapsedBox.height)).toBe(Math.round(viewBox.y + viewBox.height));
});
