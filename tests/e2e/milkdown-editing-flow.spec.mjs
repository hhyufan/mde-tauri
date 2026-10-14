import { test, expect } from '@playwright/test';

const code = '```text\nfirst\nlast\n```\n';
const table = '| A | B |\n| --- | --- |\n| one | two |\n';
async function open(page, content) {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(content)}`);
  await expect(page.locator('.milkdown-editor')).toBeVisible();
}

test('Down at the last code line opens a paragraph after the code, with undo', async ({ page }) => {
  await open(page, code);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('后续正文');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('后续正文');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('first\nlast');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
});

test('Up at the first code line opens a paragraph before the code', async ({ page }) => {
  await open(page, code);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode('start'));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.insertText('前面正文');
  await expect(page.locator('.milkdown-editor > p').first()).toHaveText('前面正文');
  await expect(page.locator('.milkdown-editor > .milkdown-code-block')).toBeVisible();
});

test('code Enter still inserts a code newline; Ctrl+Enter exits from any line', async ({ page }) => {
  await open(page, code);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode('start'));
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.trial.markdown())).toContain('\n\nfirst');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.insertText('代码之外');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('代码之外');
});

test('Down at the last table cell continues outside the table', async ({ page }) => {
  await open(page, table);
  await page.evaluate(() => window.trial.selectCell());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('表格之后');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('表格之后');
  await expect(page.locator('td').last()).toHaveText('two');
});

test('Ctrl+Shift+Enter inserts before a table and preserves its cells', async ({ page }) => {
  await open(page, table);
  await page.evaluate(() => window.trial.selectCell());
  await page.keyboard.press('Control+Shift+Enter');
  await page.keyboard.insertText('表格之前');
  await expect(page.locator('.milkdown-editor > p').first()).toHaveText('表格之前');
  await expect(page.locator('td').last()).toHaveText('two');
});

test('adjacent blocks allow an empty paragraph between them without editing either block', async ({ page }) => {
  await open(page, code + '\n' + table);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('块之间');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('块之间');
  await expect(page.locator('td').last()).toHaveText('two');
});

test('clicking blank space below the last block starts a paragraph', async ({ page }) => {
  await open(page, code);
  const block = await page.locator('.milkdown-code-block').boundingBox();
  await page.mouse.click(block.x + 15, block.y + block.height + 30);
  await page.keyboard.insertText('点击后续写');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('点击后续写');
});

test('clicking beyond a centered heading tail places the caret at its end', async ({ page }) => {
  await open(page, '# 大标题 **末尾**\n\n正文\n');
  const heading = page.locator('.milkdown-editor h1');
  const box = await heading.boundingBox();
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await page.keyboard.insertText('追加');
  await expect(heading).toHaveText('大标题 末尾追加');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('正文');
});

test('clicking well below a table continues invisibly without any plus control', async ({ page }) => {
  await open(page, table);
  expect(await page.evaluate(() => window.trial.buffer())).toBe(table);
  await expect(page.locator('.milkdown-block-exit')).toHaveCount(0);
  const block = await page.locator('.milkdown-editor table').boundingBox();
  await page.mouse.click(block.x + 15, block.y + block.height + 180);
  await page.keyboard.insertText('新的标题');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('新的标题');
  await expect(page.locator('td').last()).toHaveText('two');
});

test('clicking the center of an empty document focuses its first paragraph without changing its bytes', async ({ page }) => {
  await open(page, '');
  const box = await page.locator('.md-preview--milkdown').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.milkdown-editor')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
  expect(await page.evaluate(() => window.trial.buffer())).toBe('');
  await page.keyboard.insertText('从空白开始写作');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('从空白开始写作');
});

test('an emptied document can regain the initial caret by clicking near the bottom', async ({ page }) => {
  await open(page, '之前的正文\n');
  await page.locator('.milkdown-editor > p').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  const box = await page.locator('.md-preview--milkdown').boundingBox();
  await page.mouse.click(box.x + box.width - 60, box.y + box.height - 60);
  await expect(page.locator('.milkdown-editor')).toBeFocused();
  await page.keyboard.insertText('重新输入');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('重新输入');
});

test('clicking far below a code block focuses prose instead of its code editor', async ({ page }) => {
  await open(page, code);
  await expect(page.locator('.cm-content')).toBeVisible();
  const block = await page.locator('.milkdown-code-block').boundingBox();
  await page.mouse.click(block.x + block.width / 2, block.y + block.height + 200);
  await page.keyboard.insertText('空白处续写');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('空白处续写');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('first\nlast');
});

test('existing following prose is reused and selecting code does not exit on Shift+Down', async ({ page }) => {
  await open(page, code + '\n已有正文\n');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('插入');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('插入已有正文');
  await page.evaluate(() => window.trial.selectCode('start'));
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
});

test('wrapped heading tail, inline formula and code can receive a caret after their content', async ({ page }) => {
  const title = '很长的标题'.repeat(16) + ' `尾部代码` $x^2$';
  await open(page, '# ' + title + '\n\n正文\n');
  await expect(page.locator('.katex')).toBeVisible();
  const heading = page.locator('.milkdown-editor h1');
  const box = await heading.boundingBox();
  await page.mouse.click(box.x + box.width - 5, box.y + box.height - 10);
  await page.keyboard.insertText('尾部追加');
  await expect(heading).toContainText('尾部追加');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('正文');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$x^2$');
});

test('a formula block can be selected and exited without changing its expression', async ({ page }) => {
  await open(page, '$$\nx^2+y^2\n$$\n');
  await expect(page.locator('.katex')).toBeVisible();
  await page.locator('.md-preview__math--block').click();
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('公式之后');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('公式之后');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('x^2+y^2');
});

test('readonly preview has no continuation controls and never changes its document', async ({ page }) => {
  await page.goto(`/tests/milkdown-flow-harness.html?readonly&content=${encodeURIComponent(table)}`);
  await expect(page.locator('.milkdown-editor--readonly')).toBeVisible();
  await expect(page.locator('.milkdown-block-exit')).toHaveCount(0);
  const box = await page.locator('.md-preview--milkdown').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 50);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.buffer())).toBe(table);
});

test('a wrapped code line keeps Down inside the code until its final visual line', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 720 });
  await open(page, '```text\n' + 'long code line '.repeat(40) + '\n```\n');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(() => window.trial.selectCode('start'));
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
  await page.evaluate(() => window.trial.selectCode());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('换行后正文');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('换行后正文');
});

test('Enter after a heading continues as prose and Chinese composition commits there', async ({ page }) => {
  await open(page, '# 标题\n');
  await page.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
  await expect(page.locator('h1')).toHaveText('标题');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
  await expect(page.locator('.milkdown-editor > p')).toHaveText('中文');
  await cdp.send('Input.insertText', { text: '中文正文' });
  await expect(page.locator('.milkdown-editor > p')).toHaveText('中文正文');
  await expect(page.locator('h1')).toHaveText('标题');
});

test.describe('touch input', () => {
  test.use({ hasTouch: true });
  test('tapping empty space starts writing in an empty Markdown document', async ({ page }) => {
    await open(page, '');
    const box = await page.locator('.md-preview--milkdown').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.milkdown-editor')).toBeFocused();
    await page.keyboard.insertText('触屏写作');
    await expect(page.locator('.milkdown-editor > p')).toHaveText('触屏写作');
  });
});
