import { expect, test } from '@playwright/test';

for (const [scene, selector, next] of [
  ['WYSIWYG', '.scene-writing-demo', 'WRITE'],
  ['WRITE', '.scene-editor-split', 'LANGUAGE'],
  ['LANGUAGE', '.scene-language-demo', 'PERSONALIZE'],
  ['PERSONALIZE', '.scene-theme-demo', 'ORGANIZE'],
  ['ORGANIZE', '.scene-tree-demo', 'WYSIWYG'],
]) {
  test(`${scene} advances 1000ms after its actual animation finishes`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: scene, exact: true }).click();
    await expect(page.locator(selector)).toBeVisible();
    await page.evaluate(
      ({ selector, next }) => {
        window.playbackTiming = {};
        const observer = new MutationObserver(() => {
          const current = document.querySelector(selector);
          if (
            current?.getAttribute('data-complete') === 'true' &&
            window.playbackTiming.finished === undefined
          ) {
            window.playbackTiming.finished = performance.now();
          }
          if (
            document
              .querySelector(`.dots button[aria-label="${next}"]`)
              ?.getAttribute('aria-pressed') === 'true'
          ) {
            window.playbackTiming.switched = performance.now();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { subtree: true, attributes: true, childList: true });
      },
      { selector, next },
    );
    await expect
      .poll(() => page.evaluate(() => window.playbackTiming.switched), { timeout: 15000 })
      .toBeDefined();
    const delay = await page.evaluate(
      () => window.playbackTiming.switched - window.playbackTiming.finished,
    );
    expect(delay).toBeGreaterThanOrEqual(990);
    expect(delay).toBeLessThan(1350);
  });
}

test('history chevron is an aligned SVG and theme controls fit inside the footer', async ({
  page,
}) => {
  await page.goto('/');
  const chevron = page.locator('.scene-history svg');
  expect(await chevron.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual([
    16, 16,
  ]);
  await page.getByRole('button', { name: 'PERSONALIZE', exact: true }).click();
  const fits = await page.locator('.scene-theme-demo > .scene-theme-frame').evaluate((frame) => {
    const footer = frame.querySelector('.scene-theme-footer');
    const button = frame.querySelector('.scene-theme-switch');
    const rootBox = frame.getBoundingClientRect(),
      footerBox = footer.getBoundingClientRect(),
      buttonBox = button.getBoundingClientRect();
    return (
      footerBox.bottom <= rootBox.bottom + 1 &&
      buttonBox.bottom <= footerBox.bottom &&
      buttonBox.top >= footerBox.top
    );
  });
  expect(fits).toBe(true);
  await page.screenshot({ path: 'test-results/installer-theme-footer.png' });
});
