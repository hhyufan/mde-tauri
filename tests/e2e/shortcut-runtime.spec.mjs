import { test, expect } from '@playwright/test';

/** 打开脚手架并恢复默认键位，保证用例从干净状态开始。 */
async function openHarness(page) {
  await page.goto('/tests/shortcut-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.setting-row');
  await page.evaluate(() => window.trial.reset());
}

/** 打开脚手架但保留已持久化的键位，用于验证刷新后的行为。 */
async function openHarnessKeepingBindings(page) {
  await page.goto('/tests/shortcut-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.setting-row');
}

test('Ctrl+Shift+/ toggles preview even though the typed character is "?"', async ({ page }) => {
  await openHarness(page);
  // 回归点：按住 Shift 时 `key` 是 '?'，而 `code` 仍是 'Slash'。
  // 旧实现比较 `e.key === '/'`，因此这个快捷键永远不可能触发。
  await page.keyboard.press('Control+Shift+Slash');
  await expect.poll(() => page.evaluate(() => window.trial.viewMode())).toBe('preview');
  expect(await page.evaluate(() => window.trial.hits)).toEqual([
    { id: 'togglePreview', code: 'Slash', key: '?' },
  ]);

  await page.keyboard.press('Control+Shift+Slash');
  await expect.poll(() => page.evaluate(() => window.trial.viewMode())).toBe('edit');
});

test('a rebound shortcut moves the action to the new key and frees the old one', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.trial.setHotkey('togglePreview', 'Ctrl+Alt+KeyP'));

  await page.keyboard.press('Control+Shift+Slash');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.trial.hits)).toEqual([]);
  expect(await page.evaluate(() => window.trial.viewMode())).toBe('edit');

  await page.keyboard.press('Control+Alt+KeyP');
  await expect.poll(() => page.evaluate(() => window.trial.viewMode())).toBe('preview');
});

test('a conflicting keybinding is rejected and leaves the existing one intact', async ({ page }) => {
  await openHarness(page);
  // `search` 默认已占用 Ctrl+P。
  const result = await page.evaluate(() => window.trial.setHotkey('toggleSidebar', 'Ctrl+KeyP'));
  expect(result).toEqual({ ok: false, reason: 'conflict', conflictWith: 'search' });
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('Ctrl+KeyB');
  expect(await page.evaluate(() => window.trial.hotkeys().search)).toBe('Ctrl+KeyP');
});

test('invalid keybindings are rejected with a reason', async ({ page }) => {
  await openHarness(page);
  // 普通字母键会吞掉正常输入；剪贴板组合必须保持可用。
  expect(await page.evaluate(() => window.trial.setHotkey('search', 'KeyP')))
    .toEqual({ ok: false, reason: 'needsModifier' });
  expect(await page.evaluate(() => window.trial.setHotkey('search', 'Ctrl+KeyC')))
    .toEqual({ ok: false, reason: 'reserved' });
  expect(await page.evaluate(() => window.trial.setHotkey('search', 'ControlLeft')))
    .toEqual({ ok: false, reason: 'modifierOnly' });
  // 注意：必须先 await 再取 .ok，直接 `page.evaluate(...).ok` 是在 Promise 上取属性。
  const accepted = await page.evaluate(() => window.trial.setHotkey('search', 'Ctrl+KeyP'));
  expect(accepted).toEqual({ ok: true });
});

test('a custom binding survives a reload, and clearing it disables the action', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.trial.setHotkey('toggleSidebar', 'Ctrl+Alt+KeyL'));
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('Ctrl+Alt+KeyL');

  await page.reload();
  await openHarnessKeepingBindings(page);
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('Ctrl+Alt+KeyL');

  // 清空表示“禁用”，不应回落到默认值。
  await page.evaluate(() => window.trial.setHotkey('toggleSidebar', ''));
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('');

  // 清空后再刷新，仍然保持禁用。
  await page.reload();
  await openHarnessKeepingBindings(page);
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('');

  await page.evaluate(() => window.trial.reset());
});
