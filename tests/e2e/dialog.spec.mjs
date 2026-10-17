import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  for (const background of [false, true]) {
    test(`${theme}, wallpaper ${background}: readable dialog surfaces and intact actions`, async ({ page }) => {
      await page.goto('/tests/dialog-harness.html');
      await page.waitForFunction(() => window.trial);
      for (const kind of ['recovery', 'unsaved', 'delete']) {
        await page.evaluate((options) => window.trial.apply(options), { theme, background, kind });
        const dialog = page.locator('.moki-dialog-root .ant-modal-content');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.ant-modal-title')).toHaveCSS('font-size', '14px');
        await expect(dialog.locator('.ant-modal-body')).toHaveCSS('padding', '18px 20px');
        await expect.poll(() => dialog.evaluate((el) => {
          const style = getComputedStyle(el);
          return { opaque: !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor), wallpaper: style.backgroundImage.includes('data:image/svg'), aligned: el.style.getPropertyValue('--moki-popup-x') !== '', fits: el.scrollWidth <= el.clientWidth };
        })).toEqual({ opaque: true, wallpaper: background, aligned: background, fits: true });
        if (kind === 'recovery') {
          const checkbox = dialog.getByRole('checkbox');
          await checkbox.uncheck();
          await expect(dialog.getByRole('button', { name: /恢复所选/ })).toBeDisabled();
          await checkbox.check();
          await dialog.getByRole('button', { name: /恢复所选/ }).click();
        } else if (kind === 'unsaved') {
          await dialog.getByRole('checkbox').uncheck();
          await expect(dialog.locator('.unsaved-modal__save')).toBeDisabled();
          await dialog.getByRole('checkbox').check();
          await dialog.locator('.unsaved-modal__save').click();
        } else {
          await dialog.locator('.ant-modal-footer .ant-btn-dangerous').click();
        }
        if (background && kind === 'recovery') await page.screenshot({ path: `test-results/dialog-${theme}.png` });
      }
      expect(await page.evaluate(() => window.events)).toEqual([1, 'save', 'delete']);
    });
  }
}
