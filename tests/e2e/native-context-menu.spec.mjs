import { test, expect } from '@playwright/test';

test('default WebView menus are cancelled while Monaco commands and input shortcuts work', async ({ page }) => {
  await page.goto('/tests/background-harness.html');
  await page.waitForFunction(() => window.trial);
  const cancelled = await page.evaluate(() => [document.body, document.querySelector('input')].map((target) =>
    !target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))));
  expect(cancelled).toEqual([true, true]);
  await page.locator('.monaco-editor .view-lines').click({ button: 'right', position: { x: 50, y: 20 } });
  await expect(page.locator('.monaco-context-menu')).toBeVisible();
  await page.locator('.monaco-context-menu__label').filter({ hasText: /^Select All$/ }).click();
  await expect(page.locator('.monaco-context-menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.editor.getSelection().endLineNumber)).toBe(60);

  const input = page.locator('.search-dropdown > input');
  await input.fill('background');
  await input.press('Control+a');
  expect(await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('background');
});
