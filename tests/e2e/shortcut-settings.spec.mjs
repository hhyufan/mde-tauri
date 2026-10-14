import { test, expect } from '@playwright/test';

test('the real settings modal exposes the shortcuts panel and records a binding', async ({ page }) => {
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto('/tests/settings-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.evaluate(() => window.trial.resetHotkeys());

  // 打开真实的设置弹窗，切到「快捷键」分组。
  const navItem = page.locator('.settings-modal__nav li', { hasText: '快捷键' });
  await expect(navItem).toBeVisible();
  await navItem.click();

  await expect(page.locator('.shortcut-input__field')).toHaveCount(11);

  // 预览切换应显示 Ctrl+Shift+/，也就是修复后真正能按出来的那个键位。
  const previewRow = page.locator('.setting-row', { hasText: '切换编辑 / 预览' }).first();
  const previewButton = previewRow.locator('.shortcut-input__field');
  await expect(previewButton).toContainText('Ctrl+Shift+/');

  // 录入一个新组合，并确认写进了 store。
  await previewButton.click();
  await page.keyboard.press('Control+Alt+KeyJ');
  await expect(previewButton).toContainText('Ctrl+Alt+J');
  expect(await page.evaluate(() => window.trial.hotkeys().togglePreview)).toBe('Ctrl+Alt+KeyJ');

  // 恢复默认，避免污染后续本地存储。
  await page.evaluate(() => window.trial.resetHotkeys());
});

test('the reset tooltip stays inside the scrollable settings panel', async ({ page }) => {
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto('/tests/settings-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.evaluate(() => window.trial.resetHotkeys());
  await page.locator('.settings-modal__nav li', { hasText: '快捷键' }).click();
  await page.waitForSelector('.shortcut-input__field');

  // 改成非默认值，让框内的重置按钮出现。
  const row = page.locator('.setting-row', { hasText: '切换侧边栏' }).first();
  await row.locator('.shortcut-input__field').click();
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(row.locator('.shortcut-input__kbd')).toHaveText('Ctrl+Shift+Z');
  await row.locator('.shortcut-input__reset').hover();
  await expect(page.locator('.ant-tooltip-inner', { hasText: '恢复该动作的默认键位' })).toHaveCount(1);

  // 设置内容是 overflow:auto 的滚动容器，浮出它的部分会被硬裁掉。
  // 曾经这个提示锚在贴右的小按钮上，右侧越出面板 42px 而被切掉。
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('.settings-modal__content')?.getBoundingClientRect();
    const tipEl = [...document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)')]
      .find((tip) => tip.textContent?.includes('恢复该动作的默认键位'));
    if (!panel || !tipEl) return null;
    const tipBox = tipEl.getBoundingClientRect();
    return {
      panelRight: Math.round(panel.right),
      tipRight: Math.round(tipBox.right),
      overflowsPanelRight: tipBox.right > panel.right,
      overflowsPanelLeft: tipBox.left < panel.left,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry.overflowsPanelRight).toBe(false);
  expect(geometry.overflowsPanelLeft).toBe(false);

  await page.evaluate(() => window.trial.resetHotkeys());
});
