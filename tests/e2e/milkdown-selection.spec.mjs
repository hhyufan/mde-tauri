import { test, expect } from '@playwright/test';

test('Milkdown code selection uses the shared colour when focused, blurred and after theme changes', async ({ page }, testInfo) => {
  await page.goto('/tests/preview-harness.html?renderer=milkdown');
  const content = page.locator('.milkdown-code-block .cm-content').first();
  await expect(content).toBeVisible();
  // Create a real CodeMirror selection spanning multiple lines and a blank line.
  await page.evaluate(() => window.trial.selectCode());
  const editor = page.locator('.milkdown-code-block .cm-editor').first();
  const selection = editor.locator('.cm-selectionBackground');
  await expect(selection.first()).toBeVisible();

  for (const options of [
    { theme: 'dark', background: true },
    { theme: 'light', background: true },
    { theme: 'light', background: false },
    { theme: 'dark', background: false },
  ]) {
    await page.evaluate((value) => window.trial.apply(value), options);
    for (const focused of [true, false]) {
      await content.evaluate((el, focus) => focus ? el.focus() : el.blur(), focused);
      await expect.poll(() => editor.evaluate((el) => el.classList.contains('cm-focused'))).toBe(focused);
      await expect.poll(() => editor.evaluate((el) => {
        const expected = getComputedStyle(document.body, '::selection').backgroundColor;
        const boxes = [...el.querySelectorAll('.cm-selectionBackground')];
        return boxes.length > 0 && boxes.every((box) => getComputedStyle(box).backgroundColor === expected);
      })).toBe(true);
      if (options.theme === 'dark' && options.background && focused) {
        await page.screenshot({ path: testInfo.outputPath('dark-selection.png') });
      }
    }
  }
});
