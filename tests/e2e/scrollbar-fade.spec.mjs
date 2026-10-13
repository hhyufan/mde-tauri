import { test, expect } from '@playwright/test';

async function nativeThumbAlpha(page) {
  return page.locator('#scrollbar-probe').evaluate((el) => {
    const color = getComputedStyle(el).getPropertyValue('--moki-scrollbar-color');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
}

async function setup(page) {
  await page.goto('/tests/background-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'scrollbar-probe';
    probe.style.cssText = 'position:absolute;left:20px;top:100px;width:120px;height:120px;overflow:auto;z-index:50';
    const content = document.createElement('div');
    content.style.cssText = 'height:600px;width:600px';
    probe.appendChild(content);
    document.body.appendChild(probe);
  });
}

test('each scroll container independently fades its own scrollbar in both themes', async ({ page }) => {
  await setup(page);
  const monacoBar = page.locator('.monaco-editor .scrollbar.vertical').first();
  const breadcrumbBar = page.locator('.footer__breadcrumb-scrollbar');
  const opacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));

  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => window.trial.apply({ theme, background: false }), theme);
    await page.mouse.move(-10, -10);
    await expect.poll(() => nativeThumbAlpha(page)).toBe(0);
    await expect.poll(() => opacity(monacoBar)).toBe(0);
    await expect.poll(() => opacity(breadcrumbBar)).toBe(0);
    const size = await page.locator('#scrollbar-probe').evaluate((el) => el.clientWidth);

    // Hovering the native container must not reveal unrelated scrollbars.
    await page.mouse.move(60, 140);
    const visibleAlpha = theme === 'dark' ? 107 : 64;
    await expect.poll(() => nativeThumbAlpha(page)).toBe(visibleAlpha);
    expect(await opacity(monacoBar)).toBe(0);
    expect(await opacity(breadcrumbBar)).toBe(0);
    expect(await page.locator('#scrollbar-probe').evaluate((el) => el.clientWidth)).toBe(size);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.locator('#scrollbar-probe').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await page.mouse.move(300, 300);
    // Check an intermediate frame, not only the transition's end state.
    await expect.poll(() => nativeThumbAlpha(page), { intervals: [50] }).toBeLessThan(visibleAlpha);
    expect(await nativeThumbAlpha(page)).toBeGreaterThan(0);
    await expect.poll(() => nativeThumbAlpha(page)).toBe(0);
    await expect.poll(() => opacity(monacoBar)).toBe(1);
    await expect(monacoBar).toHaveCSS('pointer-events', 'auto');
    expect(await opacity(breadcrumbBar)).toBe(0);

    await page.locator('.footer__breadcrumb').hover();
    await expect.poll(() => opacity(monacoBar), { intervals: [50] }).toBeLessThan(1);
    expect(await opacity(monacoBar)).toBeGreaterThan(0);
    await expect.poll(() => opacity(breadcrumbBar)).toBe(1);
    await expect.poll(() => opacity(monacoBar)).toBe(0);
    await expect(monacoBar).toHaveCSS('pointer-events', 'none');
    expect(await nativeThumbAlpha(page)).toBe(0);

    await page.mouse.move(60, 140);
    await expect.poll(() => nativeThumbAlpha(page)).toBe(visibleAlpha);
    const colors = await page.locator('#scrollbar-probe').evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        // 期望值从变量推导：硬编码 rgba 会把“各处同款”这条断言绑死在
        // 某一档取值上，改配色就得同步改测试。
        expected: root.getPropertyValue('--moki-scrollbar-thumb').trim(),
        monaco: getComputedStyle(document.querySelector('.monaco-editor .scrollbar.vertical > .slider')).backgroundColor,
        breadcrumb: getComputedStyle(document.querySelector('.footer__breadcrumb-scrollbar-thumb')).backgroundColor,
      };
    });
    // 三处必须同款（原生滑块走同一支 --moki-scrollbar-thumb）。
    expect(colors.monaco).toBe(colors.expected);
    expect(colors.breadcrumb).toBe(colors.expected);
  }
});

test('native scrollbar skin removes arrow buttons and keeps nested containers independent', async ({ page }) => {
  await setup(page);
  const probe = page.locator('#scrollbar-probe');
  const skin = await probe.evaluate((el) => {
    const button = getComputedStyle(el, '::-webkit-scrollbar-button');
    return {
      color: getComputedStyle(el).scrollbarColor,
      display: button.display,
      width: button.width,
      height: button.height,
    };
  });
  expect(skin).toEqual({ color: 'auto', display: 'none', width: '0px', height: '0px' });
  await probe.evaluate((el) => {
    const nested = document.createElement('div');
    nested.id = 'nested-scrollbar-probe';
    nested.style.cssText = 'width:50px;height:50px;overflow:auto';
    const content = document.createElement('div');
    content.style.height = '200px';
    nested.appendChild(content);
    el.firstChild.appendChild(nested);
  });
  await page.mouse.move(100, 180);
  await expect.poll(() => nativeThumbAlpha(page)).toBeGreaterThan(60);
  await expect(page.locator('#nested-scrollbar-probe')).toHaveCSS('--moki-scrollbar-color', 'rgba(0, 0, 0, 0)');
});

test('reduced motion disables scrollbar fades', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await page.mouse.move(60, 140);
  await expect.poll(() => nativeThumbAlpha(page)).toBeGreaterThan(60);
  await page.mouse.move(-10, -10);
  expect(await nativeThumbAlpha(page)).toBe(0);
  await expect(page.locator('.monaco-editor .scrollbar.vertical').first()).toHaveCSS('transition-duration', '0s');
});

test('touch devices retain visible native scrollbars without hover', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await setup(page);
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  expect(await nativeThumbAlpha(page)).toBeGreaterThan(60);
  await context.close();
});
