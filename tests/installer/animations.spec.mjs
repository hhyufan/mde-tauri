import { expect, test } from '@playwright/test';

test('WYSIWYG leads the carousel; split source types and renders the same live Markdown', async ({
  page,
}) => {
  await page.goto('/');
  const dots = page.getByRole('navigation', { name: '切换功能介绍' }).getByRole('button');
  expect(
    await dots.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
  ).toEqual(['WYSIWYG', 'WRITE', 'LANGUAGE', 'PERSONALIZE', 'ORGANIZE']);
  await expect(dots.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.card-motion.is-visible .scene-writing-demo')).toBeVisible();
  await page.getByRole('button', { name: 'WRITE', exact: true }).click();
  const code = page.getByLabel('Markdown 源码自动输入演示');
  await expect(code).not.toContainText('写下新的故事');
  await expect(code).toContainText('## 从灵感开始', { timeout: 6000 });
  await expect(page.locator('.scene-split-preview h2')).toHaveText('从灵感开始');
  await expect(page.locator('.scene-editor-split')).toHaveAttribute('data-complete', 'true', {
    timeout: 10000,
  });
  await expect(page.locator('.scene-split-preview strong')).toHaveText('文字');
  await expect(page.locator('.scene-split-preview blockquote')).toHaveText('好的想法，值得记录。');
  await page.screenshot({ path: 'test-results/installer-split-animation.png' });
});

test('theme changes reveal a circular layer from the toggle without changing the installer theme', async ({
  page,
}) => {
  await page.goto('/');
  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'PERSONALIZE', exact: true }).click();
  const demo = page.locator('.scene-theme-demo');
  await expect(demo).toHaveAttribute('data-theme-state', 'light');
  await expect(page.locator('.scene-theme-ripple')).toBeAttached({ timeout: 3000 });
  await expect(page.locator('.scene-theme-ripple')).toHaveCSS('clip-path', /circle\(/);
  await page.screenshot({ path: 'test-results/installer-theme-ripple.png' });
  await expect(demo).toHaveAttribute('data-theme-state', 'dark');
  await expect(demo).toHaveAttribute('data-theme-state', 'light', { timeout: 6000 });
  expect(await page.locator('html').getAttribute('data-theme')).toBe(initialTheme);
});

test('knowledge tree is built from a root with actual inline naming and increasing node count', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ORGANIZE', exact: true }).click();
  await expect(page.locator('.moki-tree__count')).toHaveText('0 个节点');
  await expect(page.getByLabel('新节点名称')).toBeVisible();
  await expect(page.getByText('我的知识空间', { exact: true })).toBeVisible();
  await expect(page.locator('.moki-tree__count')).toHaveText('2 个节点');
  await expect(page.locator('.scene-tree-demo')).toHaveAttribute('data-complete', 'true', {
    timeout: 12000,
  });
  await expect(page.locator('.moki-tree__count')).toHaveText('7 个节点');
  await expect(page.getByText('收藏的句子', { exact: true })).toBeVisible();
  await expect(page.getByLabel('新节点名称')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/installer-tree-animation.png' });
  await page.getByRole('button', { name: 'WRITE', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'ORGANIZE', exact: true }).click();
  await expect(page.locator('.moki-tree__count')).toHaveText('0 个节点');
});

test('first scene types checked and unchecked tasks without scrolling', async ({ page }) => {
  await page.goto('/');
  const demo = page.locator('.scene-writing-demo');
  await expect(demo).toHaveAttribute('data-complete', 'true', { timeout: 15000 });
  await expect(demo.locator('li[data-checked="true"]')).toHaveText('记录今天的灵感');
  await expect(demo.locator('li[data-checked="false"]')).toHaveText('写下新的故事');
  await expect(demo.locator('li').last().locator('.scene-demo-caret')).toHaveCount(1);
  expect(
    await demo.evaluate((panel) => {
      const last = panel.querySelector('li:last-child').getBoundingClientRect();
      return (
        panel.scrollHeight <= panel.clientHeight &&
        last.bottom <= panel.getBoundingClientRect().bottom
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/installer-wysiwyg-tasks.png' });
});

test('scene, copy and mascot crossfade while the outgoing editor remains mounted', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.scene-writing-demo h1')).toBeAttached();
  await page.getByRole('button', { name: 'WRITE', exact: true }).click();
  await page.waitForTimeout(180);
  const opacities = await page.evaluate(() =>
    ['.card-motion', '.copy', '.mascot'].map((selector) => {
      const elements = document.querySelectorAll(selector);
      return [
        Number(getComputedStyle(elements[0]).opacity),
        Number(getComputedStyle(elements[1]).opacity),
      ];
    }),
  );
  for (const [outgoing, incoming] of opacities) {
    expect(outgoing).toBeGreaterThan(0);
    expect(outgoing).toBeLessThan(1);
    expect(incoming).toBeGreaterThan(0);
    expect(incoming).toBeLessThan(1);
  }
  await expect(page.locator('.scene-writing-demo')).toHaveCount(1);
  await expect(page.locator('.scene-writing-demo')).toHaveCount(0);
});

test('reduced motion shows finished split and tree demos and a static theme', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'WRITE', exact: true }).click();
  await expect(page.locator('.scene-editor-split')).toHaveAttribute('data-complete', 'true');
  await page.getByRole('button', { name: 'PERSONALIZE', exact: true }).click();
  await expect(page.locator('.scene-theme-ripple')).toHaveCount(0);
  await page.getByRole('button', { name: 'ORGANIZE', exact: true }).click();
  await expect(page.locator('.moki-tree__count')).toHaveText('7 个节点');
});
