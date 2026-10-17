import { expect, test } from '@playwright/test';

async function open(page, content, toolbar = false) {
  await page.goto(
    `/tests/milkdown-flow-harness.html?${toolbar ? 'toolbar&' : ''}content=${encodeURIComponent(content)}`,
  );
  await expect(page.locator('.milkdown-editor')).toBeVisible();
}

for (const theme of ['light', 'dark']) {
  test(`table insertion panel fits its fields and translucent button in ${theme} theme`, async ({
    page,
  }) => {
    await open(page, '正文\n', true);
    await page.locator('html').evaluate((element, theme) => {
      element.dataset.theme = theme;
    }, theme);
    await page.locator('.ft__table-wrap > button').click();
    const panel = page.locator('.ft__table-panel');
    await expect(panel).toBeVisible();
    const result = await panel.evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      const fields = [...panel.querySelectorAll('form > *, .ant-input-number')].map((el) =>
        el.getBoundingClientRect(),
      );
      return {
        fits: fields.every((box) => box.left >= bounds.left && box.right <= bounds.right),
        background: getComputedStyle(panel.querySelector('form > button')).backgroundColor,
        scroll: panel.scrollWidth <= panel.clientWidth,
      };
    });
    expect(result.fits).toBe(true);
    expect(result.scroll).toBe(true);
    expect(result.background).toMatch(/(?:0\.14|14%)/);
    await page.screenshot({ path: `test-results/table-controls-${theme}.png` });
  });
}

test('native table and HTML node controls use Antd tooltips for hover and keyboard focus', async ({
  page,
}) => {
  await open(page, '| A | B |\n| --- | --- |\n| one | two |\n\n<div>HTML preview</div>\n');
  const table = page.locator('.moki-table');
  await table.hover();
  const edit = page.locator('.moki-table__edit');
  await edit.hover();
  await expect(page.getByRole('tooltip')).toHaveText(await edit.getAttribute('aria-label'));
  await expect(edit).not.toHaveAttribute('title');
  await edit.click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('.ft__table-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.md-preview__html-block').hover();
  const html = page.locator('.md-preview__html-edit');
  await html.focus();
  await expect(page.getByRole('tooltip')).toHaveText(await html.getAttribute('aria-label'));
  const tooltipId = await page.getByRole('tooltip').getAttribute('id');
  await expect(html).toHaveAttribute('aria-describedby', tooltipId);
  expect(await page.evaluate(() => window.trial.markdown())).toContain('<div>HTML preview</div>');
});

test('code language controls and custom math rendering expose tooltips without changing Markdown', async ({
  page,
}) => {
  await open(page, '```text\nhello\n```\n\n$x+y$\n');
  await page.locator('.milkdown-code-block').hover();
  await page.locator('.language-button').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Choose code language');
  await page.locator('[data-type="math_inline"] .katex-html').hover();
  await expect(page.getByRole('tooltip')).toContainText('Backspace');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$x+y$');
});
