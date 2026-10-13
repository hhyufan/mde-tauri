import { test, expect } from '@playwright/test';

const menu = (page) => page.getByRole('menu');
const action = (page, name) => page.getByRole('menuitem', { name, exact: true });
async function load(page, mode) {
  await page.goto(`/tests/editor-context-menu-harness.html?mode=${mode}`);
  await page.waitForFunction(() => window.trial);
  await expect(page.locator(mode === 'tree' ? '.moki-tree__title' : mode === 'milkdown' ? '.milkdown-editor' : '.md-preview').first()).toBeVisible();
}

test('preview menu keeps the selection, copies original Markdown and never offers editing actions', async ({ page }) => {
  await load(page, 'preview');
  await page.evaluate(() => window.trial.selectText('Alpha'));
  await page.locator('.md-preview p').first().click({ button: 'right' });
  await expect(menu(page)).toHaveAttribute('data-menu-variant', 'preview');
  await expect(action(page, 'Copy')).toHaveAttribute('aria-keyshortcuts', 'Control+C');
  await expect(menu(page).getByRole('separator')).toHaveCount(1);
  await expect(action(page, 'Paste')).toHaveCount(0);
  await action(page, 'Copy').click();
  expect(await page.evaluate(() => window.trial.clipboard)).toBe('Alpha');
  await page.locator('.md-preview').click({ button: 'right', position: { x: 900, y: 650 } });
  const box = await menu(page).boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(1280); expect(box.y + box.height).toBeLessThanOrEqual(720);
  await action(page, 'Copy all').click();
  expect(await page.evaluate(() => window.trial.clipboard)).toBe(await page.evaluate(() => window.trial.source));
});

test('Milkdown menu formats the selected text, supports undo/redo and pastes through editor transactions', async ({ page }) => {
  await load(page, 'milkdown');
  await page.evaluate(() => window.trial.selectText('Alpha'));
  const paragraph = page.locator('.milkdown-editor > p').first();
  await paragraph.click({ button: 'right' });
  await expect(menu(page)).toHaveAttribute('data-menu-variant', 'wysiwyg');
  await expect(action(page, 'Bold')).toHaveAttribute('aria-keyshortcuts', 'Control+B');
  await expect(menu(page).getByRole('separator')).toHaveCount(4);
  const divider = await menu(page).getByRole('separator').first().evaluate((el) => ({
    line: el.getBoundingClientRect().width, panel: el.parentElement.clientWidth,
  }));
  // 分隔线应撑满面板宽度。这里必须留容差：clientWidth 取整，而
  // getBoundingClientRect().width 是亚像素小数，两者直接比较必然差不到 1px。
  expect(Math.abs(divider.line - divider.panel)).toBeLessThanOrEqual(1);
  expect(divider.line).toBeGreaterThan(100);
  await page.keyboard.press('Control+b');
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).toContain('**Alpha**');
  await paragraph.click({ button: 'right' }); await action(page, 'Undo').click();
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).not.toContain('**Alpha**');
  await paragraph.click({ button: 'right' }); await action(page, 'Redo').click();
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).toContain('**Alpha**');
  await page.evaluate(() => { window.trial.selectText('beta'); window.trial.clipboard = 'gamma'; });
  await paragraph.click({ button: 'right' }); await action(page, 'Paste').click();
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).toContain('gamma');
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).not.toContain('beta');
});

test('Milkdown code menus copy and cut code without applying prose formatting', async ({ page }) => {
  await load(page, 'milkdown');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode());
  await page.locator('.cm-content').click({ button: 'right' });
  await expect(action(page, 'Bold')).toBeDisabled();
  await action(page, 'Copy').click();
  expect(await page.evaluate(() => window.trial.clipboard)).toContain('const a = 1;');
  await page.evaluate(() => window.trial.selectCode());
  await page.locator('.cm-content').click({ button: 'right' });
  await action(page, 'Cut').click();
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).not.toContain('const a = 1;');
});

test('tree node menus rename and add nodes, while the blank-area menu offers tree-wide actions', async ({ page }) => {
  await load(page, 'tree');
  const root = page.locator('.moki-tree__title').filter({ hasText: /^Root$/ });
  await root.click({ button: 'right' });
  await expect(menu(page)).toHaveAttribute('data-menu-variant', 'tree');
  await expect(menu(page).getByRole('separator')).toHaveCount(2);
  await page.keyboard.press('F2');
  const input = page.locator('.moki-tree__input');
  await input.fill('Renamed'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).toContain('Renamed');
  await page.locator('.moki-tree__title').filter({ hasText: /^Renamed$/ }).click({ button: 'right' });
  await action(page, 'Add child node').click();
  await input.fill('Added'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).toContain('Added');
  await page.locator('.moki-tree__scroll').click({ button: 'right', position: { x: 50, y: 300 } });
  await expect(action(page, 'Expand all')).toBeVisible();
  await expect(action(page, 'Collapse all')).toBeVisible();
});

for (const mode of ['preview', 'milkdown', 'tree']) {
  test(`${mode} context menu retains its opaque image surface in both themes`, async ({ page }, testInfo) => {
    await load(page, mode);
    const target = page.locator(mode === 'tree' ? '.moki-tree__title' : mode === 'milkdown' ? '.milkdown-editor > p' : '.md-preview p').first();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => window.trial.theme(value), theme);
      await target.click({ button: 'right' });
      const surface = await menu(page).evaluate((el) => {
        const style = getComputedStyle(el); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        ctx.fillStyle = style.backgroundColor; ctx.fillRect(0, 0, 1, 1);
        return { alpha: ctx.getImageData(0, 0, 1, 1).data[3], image: style.backgroundImage, blur: style.backdropFilter };
      });
      expect(surface.alpha).toBe(255); expect(surface.image).toContain('data:image/svg+xml'); expect(surface.blur).toBe('none');
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${theme}-menu.png`) });
      await page.keyboard.press('Escape'); await expect(menu(page)).toHaveCount(0);
    }
  });
}
