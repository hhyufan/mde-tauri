import { test, expect } from '@playwright/test';

const picture =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjQwIiBmaWxsPSJza3libHVlIi8+PC9zdmc+';
async function open(page, content = '') {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(content)}`);
  await expect(page.locator('.milkdown-editor')).toBeVisible();
}
const form = (page) => page.locator('.milkdown-media-form');
const address = (page) => page.locator('#milkdown-media-address');
const label = (page) => page.locator('#milkdown-media-text');
const submit = (page) => address(page).press('Enter');

test('toolbar link uses an inline form; cancel leaves bytes unchanged; apply renders a real link and supports undo', async ({
  page,
}) => {
  await open(page, '正文\n');
  await page.evaluate(() => {
    window.trial.selectTextblock(0, 'end');
    window.trial.toolbar('link');
  });
  await expect(form(page)).toBeVisible();
  await expect(page.locator('.ant-modal')).toHaveCount(0);
  await expect(address(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文\n');
  await page.keyboard.press('Control+k');
  await address(page).fill('https://example.com');
  await label(page).fill('项目主页');
  await submit(page);
  await expect(page.locator('.milkdown-editor a')).toHaveText('项目主页');
  await expect(page.locator('.milkdown-editor a')).toHaveAttribute('href', 'https://example.com');
  expect(await page.evaluate(() => window.trial.markdown())).toContain(
    '[项目主页](https://example.com)',
  );
  await page.keyboard.press('Control+z');
  await expect(page.locator('.milkdown-editor a')).toHaveCount(0);
});

test('handwritten links edit destination without losing inline formatting; unlink keeps the text', async ({
  page,
}) => {
  await open(page, '[**项目**主页](https://old.example)\n');
  const links = page.locator('.milkdown-editor a');
  const link = links.first();
  await link.click({ button: 'right' });
  await address(page).fill('./notes.md');
  await submit(page);
  await expect(link).toHaveAttribute('href', './notes.md');
  await expect(page.locator('.milkdown-editor strong')).toHaveText('项目');
  await link.click({ button: 'right' });
  await label(page).fill('新名称');
  await submit(page);
  await expect(link).toHaveText('新名称');
  await link.click({ button: 'right' });
  await page.locator('.milkdown-media-tools button:not([hidden])').last().click();
  await expect(links).toHaveCount(0);
  await expect(page.locator('.milkdown-editor')).toContainText('新名称');
});

test('inserting images requires an address, supplies alt, previews through antd and can be replaced inline', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.trial.toolbar('image'));
  await submit(page);
  await expect(form(page).locator('[role=alert]')).toBeVisible();
  await expect(page.locator('.milkdown-editor > p > img[src]')).toHaveCount(0);
  await address(page).fill(picture);
  await submit(page);
  const image = page.locator('.milkdown-editor > p > img[src]');
  await expect(image).toHaveAttribute('alt', /.+/);
  await image.click();
  await expect(page.locator('.ant-image-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ant-image-preview')).not.toBeVisible();
  await image.click({ button: 'right' });
  await address(page).fill('https://example.com/holiday-photo.png');
  await label(page).fill('');
  await submit(page);
  await expect(image).toHaveAttribute('alt', 'holiday photo');
  await expect(image).toHaveAttribute('src', 'https://example.com/holiday-photo.png');
  await page.keyboard.press('Control+z');
  await expect(image).toHaveAttribute('src', picture);
});

test('handwritten empty image has a visible editable placeholder', async ({ page }) => {
  await open(page, '![说明]()\n');
  await page.locator('.moki-image-empty').click({ button: 'right' });
  await expect(form(page)).toBeVisible();
  await address(page).fill(picture);
  await submit(page);
  const image = page.locator('.milkdown-editor img[src]');
  await expect(image).toHaveAttribute('src', picture);
  await expect(image).toHaveAttribute('alt', '说明');
});

test('read only images preview but expose no editing controls', async ({ page }) => {
  await page.goto(
    `/tests/milkdown-flow-harness.html?readonly&content=${encodeURIComponent(`![图](${picture})\n`)}`,
  );
  const image = page.locator('.milkdown-editor img[src]');
  await image.hover();
  await expect(page.locator('.milkdown-media-tools')).toHaveCount(0);
  await image.click();
  await expect(page.locator('.ant-image-preview')).toBeVisible();
  await expect(page.locator('.milkdown-media-preview-tools')).toHaveCount(0);
});

test('hover never opens editing; right click opens a pinned toolbar; preview edits alt and source in place', async ({
  page,
}) => {
  await open(page, `![原说明](${picture})\n\n[链接](https://example.com)\n`);
  const image = page.locator('.milkdown-editor img[src]');
  await image.hover();
  await expect(form(page)).toHaveCount(0);
  await page.locator('.milkdown-editor a').hover();
  await expect(form(page)).toHaveCount(0);
  await image.click({ button: 'right' });
  await expect(form(page)).toBeVisible();
  await expect(page.locator('.monaco-context-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await image.click();
  const tools = page.locator('.milkdown-media-preview-tools');
  await expect(tools).toBeVisible();
  await tools.locator('button').nth(0).click();
  await tools.locator('input').fill('新的说明');
  await tools.locator('input').press('Enter');
  await expect(image).toHaveAttribute('alt', '新的说明');
  await expect(page.locator('.ant-image-preview')).toBeVisible();
  await tools.locator('button').nth(1).click();
  const replacement = picture + '#replacement';
  await tools.locator('input').fill(replacement);
  await tools.locator('input').press('Enter');
  await expect(image).toHaveAttribute('src', replacement);
  await expect(page.locator('.ant-image-preview-img')).toHaveAttribute('src', replacement);
  const native = await page
    .locator('.ant-image-preview-operations-operation')
    .first()
    .boundingBox();
  const added = await tools.locator('button').first().boundingBox();
  expect(Math.abs(native.y + native.height / 2 - added.y - added.height / 2)).toBeLessThan(3);
  await page.screenshot({ path: 'test-results/milkdown-preview-toolbar.png' });
  await page.keyboard.press('Escape');
});

test('preview source input opens the native image picker and refreshes the image', async ({
  page,
}) => {
  await open(page, `![说明](${picture})\n`);
  await page.evaluate((base64) => {
    window.mediaCalls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        window.mediaCalls.push({ command, args });
        if (command === 'plugin:dialog|open') return 'C:/images/picked.svg';
        if (command === 'read_binary_file')
          return { content_base64: base64, mime_type: 'image/svg+xml' };
        return null;
      },
    };
  }, picture.split(',')[1]);
  const image = page.locator('.milkdown-editor img[src]');
  await image.click();
  const tools = page.locator('.milkdown-media-preview-tools');
  await tools.locator('button').nth(1).click();
  const editor = page.locator('.milkdown-media-preview-editor');
  await expect(editor.locator('input')).toBeVisible();
  await editor.locator('button').first().click();
  await expect
    .poll(() => page.evaluate(() => window.trial.markdown()))
    .toContain('C:/images/picked.svg');
  await expect(page.locator('.ant-image-preview-img')).toHaveAttribute('src', /^blob:/);
  expect(
    await page.evaluate(() =>
      window.mediaCalls.some(
        (call) =>
          call.command === 'plugin:dialog|open' &&
          call.args.options.filters[0].extensions.includes('png'),
      ),
    ),
  ).toBe(true);
});

test('tools reserve space above content and survive moving slowly from a link to its input', async ({
  page,
}) => {
  await open(page, '前面正文\n\n[项目主页](https://example.com)\n\n后面正文\n');
  const link = page.locator('.milkdown-editor a');
  await link.click({ button: 'right' });
  const tools = page.locator('.milkdown-media-tools');
  await expect(tools).toBeVisible();
  const toolBox = await tools.boundingBox();
  const linkBox = await link.boundingBox();
  expect(toolBox.y + toolBox.height).toBeLessThanOrEqual(linkBox.y);
  const edit = address(page);
  const box = await edit.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  // Wait beyond the hide delay to catch the original disappearing-hover bug.
  await page.waitForTimeout(450);
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(form(page)).toBeVisible();
  await expect(address(page)).toBeFocused();
  await page.screenshot({ path: 'test-results/milkdown-link-inline.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.milkdown-editor > p').last()).toHaveText('后面正文');
});
