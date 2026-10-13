import { test, expect } from '@playwright/test';

test('minimap pixels and the actual breadcrumb popup follow background and theme changes', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/tests/background-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.locator('.footer__breadcrumb-segment').filter({ hasText: /^tmp$/ }).click();
  const popup = page.locator('.footer__dropdown');
  await expect(popup).toBeVisible();
  // Ant Design portals this custom popup to body, outside the application.
  expect(await popup.evaluate((el) => el.closest('.app') === null)).toBe(true);

  for (const options of [
    { theme: 'light', background: false },
    { theme: 'light', background: true },
    { theme: 'dark', background: true },
    { theme: 'dark', background: false },
    { theme: 'light', background: true },
  ]) {
    await page.evaluate((value) => window.trial.apply(value), options);
    await expect.poll(() => page.evaluate(() => {
      const canvas = document.querySelector('.minimap canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        // A blank point must be transparent while text is still rendered.
        blankAlpha: pixels[pixels.length - 1],
        hasText: pixels.some((v, i) => i % 4 === 3 && v > 0),
      };
    })).toEqual({ blankAlpha: 0, hasText: true });

    const surface = await popup.evaluate((el) => {
      const style = getComputedStyle(el);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return { alpha: ctx.getImageData(0, 0, 1, 1).data[3], image: style.backgroundImage, blur: style.backdropFilter };
    });
    if (options.background) {
      expect(surface.image).toContain('data:image/svg+xml');
    } else {
      // 非背景模式保持不透明，避免底下的内容透上来。
      expect(surface.image).toBe('none');
    }
    expect(surface.alpha).toBe(255);
    expect(surface.blur).toBe('none');
    if (options.theme === 'dark' && options.background) {
      await page.screenshot({ path: testInfo.outputPath('dark-background.png') });
    }
  }
});
