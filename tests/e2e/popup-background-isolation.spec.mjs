import { test, expect } from '@playwright/test';

async function pixelDifference(page, first, second) {
  return page.evaluate(async ({ a, b }) => {
    const read = async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [one, two] = await Promise.all([read(a), read(b)]);
    let max = 0, total = 0;
    for (let i = 0; i < one.length; i++) {
      const delta = Math.abs(one[i] - two[i]);
      max = Math.max(max, delta); total += delta;
    }
    return { max, mean: total / one.length };
  }, { a: first.toString('base64'), b: second.toString('base64') });
}

// Compare rendered pixels, not just CSS opacity: a translucent copy of the
// wallpaper still leaks editor text even when it has the correct image URL.
async function verifyImageOnly(page, selector) {
  const popup = page.locator(selector).last();
  await expect(popup).toBeVisible();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  const hideContent = await page.addStyleTag({ content: `${selector} > * { visibility: hidden !important; }` });
  const box = await popup.boundingBox();
  const clip = { x: Math.ceil(box.x) + 14, y: Math.ceil(box.y) + 14,
    width: Math.floor(box.width) - 28, height: Math.floor(box.height) - 28 };
  const capture = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const card = await capture();

  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'occlusion-probe';
    probe.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;background:repeating-linear-gradient(90deg,#f0f 0 7px,#0f0 7px 14px);font-size:48px;color:red';
    probe.textContent = 'UNDERLYING EDITOR TEXT AND COMPONENTS '.repeat(100);
    document.querySelector('.app').appendChild(probe);
  });
  // Changing everything under the popup must not change its appearance.
  // Compositor rounding can differ by one or two channel values.
  const covered = await capture();
  expect((await pixelDifference(page, covered, card)).max).toBeLessThanOrEqual(2);
  await page.evaluate(() => document.getElementById('occlusion-probe').remove());

  const hideUi = await page.addStyleTag({ content: '.app > *, .ant-dropdown, .ant-select-dropdown { visibility: hidden !important; }' });
  const wallpaper = await capture();
  await hideUi.evaluate((el) => el.remove());
  await hideContent.evaluate((el) => el.remove());

  // The copy must match the wallpaper at the same viewport position. Allow
  // fractional popup positioning and different compositor rounding at edges.
  const difference = await pixelDifference(page, card, wallpaper);
  expect(difference.mean).toBeLessThan(1);
}

for (const theme of ['light', 'dark']) {
  test(`popups contain only aligned wallpaper (${theme})`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.goto('/tests/background-harness.html');
    await page.waitForFunction(() => window.trial);
    await page.evaluate((theme) => window.trial.apply({ theme, background: true }), theme);
    await page.locator('.footer__breadcrumb-segment').filter({ hasText: /^tmp$/ }).click();
    await verifyImageOnly(page, '.footer__dropdown');
    await page.locator('.footer__dropdown').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await verifyImageOnly(page, '.footer__dropdown');

    await page.locator('input[role="combobox"]').first().click();
    await verifyImageOnly(page, '.search-dropdown__panel');
    // Start with a fresh focus state: the pixel reference above temporarily
    // hides inputs, which deliberately triggers the browser's blur handling.
    await page.goto('/tests/background-harness.html');
    await page.waitForFunction(() => window.trial);
    await page.evaluate((theme) => window.trial.apply({ theme, background: true }), theme);
    await page.locator('input[role="combobox"]').first().click();
    await page.locator('.search-dropdown__scope .ant-select-selector').click();
    await verifyImageOnly(page, '.ant-select-dropdown');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 700, height: 850 });
    await verifyImageOnly(page, '.search-dropdown__panel');
    for (const opacity of ['0', '1', '0.35']) {
      await page.evaluate((value) => window.trial.setOpacity(Number(value)), opacity);
      await verifyImageOnly(page, '.search-dropdown__panel');
    }
    await page.screenshot({ path: testInfo.outputPath(`${theme}-image-only-popups.png`) });
  });

  test(`floating toolbar and heading menu contain only aligned wallpaper (${theme})`, async ({ page }, testInfo) => {
    await page.goto('/tests/background-harness.html');
    await page.waitForFunction(() => window.trial);
    await page.evaluate((theme) => { window.trial.apply({ theme, background: true }); window.trial.showToolbar(); }, theme);
    await verifyImageOnly(page, '.ft');
    const grip = page.locator('.ft__grip');
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 92, box.y - 108, { steps: 6 });
    await page.mouse.up();
    await verifyImageOnly(page, '.ft');
    await page.locator('.ft__heading-group .ft__btn').click();
    await verifyImageOnly(page, '.ft__heading-panel');
    await page.screenshot({ path: testInfo.outputPath(`${theme}-image-only-toolbar.png`) });
  });

  test(`Monaco context menu contains only aligned wallpaper (${theme})`, async ({ page }, testInfo) => {
    await page.goto('/tests/background-harness.html');
    await page.waitForFunction(() => window.trial);
    await page.evaluate((theme) => { window.trial.apply({ theme, background: true }); window.trial.showContextMenu(); }, theme);
    await verifyImageOnly(page, '.monaco-context-menu');
    await page.screenshot({ path: testInfo.outputPath(`${theme}-image-only-context-menu.png`) });
  });
}
