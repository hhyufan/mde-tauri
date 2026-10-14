import { test, expect } from '@playwright/test';

async function open(page, content) {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(content)}`);
  await expect(page.locator('.milkdown-editor')).toBeVisible();
}

for (const tag of ['<br>', '<br />', '<a id="section"></a>', '<div>标签</div>']) {
  test(`${tag} does not swallow an adjacent heading or formula`, async ({ page }) => {
    await open(page, `${tag}\n# 标题\n\n${tag}\n$$\nx^2\n$$\n`);
    await expect(page.locator('.milkdown-editor h1')).toHaveText('标题');
    await expect(page.locator('.md-preview__math--block .katex')).toBeVisible();
    const markdown = await page.evaluate(() => window.trial.markdown());
    expect(markdown).toContain('# 标题'); expect(markdown).toContain('x^2');
    await open(page, markdown);
    await expect(page.locator('.milkdown-editor h1')).toHaveText('标题');
    await expect(page.locator('.md-preview__math--block .katex')).toBeVisible();
  });
}

test('Backspace on the empty line above a heading removes only the empty line', async ({ page }) => {
  await open(page, '保留上一段\n\n<br />\n\n# 标题\n');
  await page.evaluate(() => window.trial.selectTextblock(1));
  await page.keyboard.press('Backspace');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('保留上一段');
  await expect(page.locator('.milkdown-editor h1')).toHaveText('标题');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(2);
});

test('plain Markdown paste renders blocks and supports undo', async ({ page }) => {
  await open(page, '');
  await page.locator('.milkdown-editor').click();
  await page.evaluate(() => window.trial.paste('# 粘贴标题\n\n**加粗**与 $x^2$\n\n| A | B |\n| --- | --- |\n| one | two |\n\n```js\nconst a = 1;\n```'));
  await expect(page.locator('.milkdown-editor h1')).toHaveText('粘贴标题');
  await expect(page.locator('.milkdown-editor strong')).toHaveText('加粗');
  await expect(page.locator('.md-preview__math--inline .katex')).toBeVisible();
  await expect(page.locator('.milkdown-editor table')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('const a = 1;');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.milkdown-editor h1')).toHaveCount(0);
});

test('Markdown paste in code stays literal, rich text keeps its formatting', async ({ page }) => {
  await open(page, '```text\ncode\n```\n\n正文\n');
  await page.evaluate(() => window.trial.selectCode());
  await page.locator('.cm-content').evaluate((el) => {
    const data = new DataTransfer(); data.setData('text/plain', '# literal');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.cm-content')).toContainText('code# literal');
  await page.evaluate(() => { window.trial.selectTextblock(1, 'end'); window.trial.paste('Bold', '<p><strong>Bold</strong></p>'); });
  await expect(page.locator('.milkdown-editor strong')).toHaveText('Bold');
});

for (const mode of [undefined, 'markdown']) {
  test(`Markdown source with highlighted HTML renders as Markdown (${mode || 'web code'})`, async ({ page }) => {
    await open(page, '');
    await page.evaluate((mode) => {
      window.trial.selectTextblock(0);
      window.trial.paste('# 来源标题\n\n**正文**', '<pre><code># 来源标题\n\n**正文**</code></pre>', mode);
    }, mode);
    await expect(page.locator('.milkdown-editor h1')).toHaveText('来源标题');
    await expect(page.locator('.milkdown-editor strong')).toHaveText('正文');
    await expect(page.locator('.cm-content')).toHaveCount(0);
  });
}

test('Backspace at a heading removes the preceding empty paragraph before changing its level', async ({ page }) => {
  await open(page, '保留上一段\n\n<br />\n\n## 标题\n');
  await page.evaluate(() => window.trial.selectTextblock(2));
  await page.keyboard.press('Backspace');
  await expect(page.locator('.milkdown-editor h2')).toHaveText('标题');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('保留上一段');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('heading');
});

test('inline br remains a hard break and an intentional HTML container stays raw', async ({ page }) => {
  await open(page, '前半<br>后半\n\n<div>\n# HTML 内部的源码\n</div>\n# 外面的标题\n');
  await expect(page.locator('.milkdown-editor > p').first().locator('br')).toHaveCount(1);
  await expect(page.locator('.milkdown-editor h1')).toHaveText('外面的标题');
  await expect(page.locator('.md-preview__html')).toContainText('# HTML 内部的源码');
});

test('emphasis following HTML keeps valid Markdown when saved and reopened', async ({ page }) => {
  await open(page, '<br>\n**加粗** _斜体_\n');
  await expect(page.locator('.milkdown-editor strong')).toHaveText('加粗');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toContain('**加粗**'); expect(markdown).toContain('_斜体_');
  await open(page, markdown);
  await expect(page.locator('.milkdown-editor strong')).toHaveText('加粗');
  await expect(page.locator('.milkdown-editor em')).toHaveText('斜体');
});

test('split preview follows the same HTML and Markdown boundaries', async ({ page }) => {
  const content = '<br>\n# 标题\n\n<div>标签</div>\n$$\nx^2\n$$\n';
  await page.goto(`/tests/preview-harness.html?content=${encodeURIComponent(content)}`);
  await expect(page.locator('.md-preview h1')).toHaveText('标题');
  await expect(page.locator('.md-preview .katex-display')).toBeVisible();
});

for (const html of ['<a id="anchor"></a>', '<!-- 保留注释 -->', '<div>保留 HTML</div>']) {
  test(`removing a blank line below ${html} leaves the caret outside the HTML`, async ({ page }) => {
    await open(page, `${html}\n\n\n# 标题\n`);
    await page.evaluate(() => window.trial.selectTextblock(1));
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => window.trial.markdown())).toContain(html);
    expect(await page.evaluate(() => window.trial.state().selection.type)).toBe('gapcursor');
    await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => window.trial.markdown())).toContain(html);
  });

  test(`rendered ${html} is a complete block with no phantom empty paragraph`, async ({ page }) => {
    await open(page, `${html}\n\n# 标题\n`);
    expect(await page.evaluate(() => window.trial.state().doc.content.map((node) => node.type))).toEqual(['html_block', 'heading']);
    await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
    expect(await page.evaluate(() => window.trial.markdown())).toContain(html);
  });
}

test('repeated Backspace below the last HTML block preserves the tag and does not save a caret paragraph', async ({ page }) => {
  const html = '<div>保留 HTML</div>';
  await open(page, `${html}\n\n\n## Tail\n`);
  // Remove the trailing heading, leaving only HTML and an authored empty line.
  await page.evaluate(() => window.trial.selectBlock(2));
  await page.keyboard.press('Delete');
  await page.evaluate(() => window.trial.selectTextblock(1));
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown.trim()).toBe(html);
  await page.locator('.milkdown-editor').evaluate((el) => el.blur());
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toBe(markdown);
});

test('Delete above HTML preserves its source and explicit selection can still delete the HTML', async ({ page }) => {
  const html = '<div>保留 HTML</div>';
  await open(page, `\n${html}\n\n正文\n`);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.trial.markdown())).toContain(html);
  expect(await page.evaluate(() => window.trial.state().doc.content.length)).toBe(2);
  await page.evaluate(() => window.trial.selectBlock(0));
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.trial.markdown())).not.toContain(html);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.trial.markdown())).toContain(html);
});

test('clicking below a standalone HTML block creates a safe caret outside its source', async ({ page }) => {
  const html = '<!-- 保留注释 -->';
  await open(page, html);
  const box = await page.locator('.md-preview--milkdown').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
  await page.keyboard.press('Backspace');
  expect((await page.evaluate(() => window.trial.markdown())).trim()).toBe(html);
  await page.keyboard.insertText('新正文');
  await expect(page.locator('.milkdown-editor > p').last()).toHaveText('新正文');
  expect(await page.evaluate(() => window.trial.markdown())).toContain(html);
});

test('the reported centered image HTML is one block; a real extra empty paragraph can be removed without losing the heading', async ({ page }) => {
  const html = '<p align="center">\n  <img src="screenshots/main.png" width="880" alt="MokiDown 主界面" />\n</p>';
  await open(page, `${html}\n\n## 功能\n`);
  expect(await page.evaluate(() => window.trial.state().doc.content.map((node) => node.type))).toEqual(['html_block', 'heading']);
  await expect(page.locator('.md-preview__html-block img')).toHaveAttribute('alt', 'MokiDown 主界面');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
  await open(page, `${html}\n\n\n## 功能\n`);
  const before = await page.locator('.milkdown-editor h2').boundingBox();
  await page.locator('.milkdown-editor > p').click();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.state().selection.type)).toBe('gapcursor');
  const after = await page.locator('.milkdown-editor h2').boundingBox();
  expect(before.y - after.y).toBeGreaterThan(10);
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toBe(`${html}\n\n## 功能\n`);
  await open(page, markdown);
  await expect(page.locator('.milkdown-editor h2')).toHaveText('功能');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(0);
});

test('Enter creates paragraphs, authored empty paragraphs survive reopening without generated br tags', async ({ page }) => {
  await open(page, '正文\n');
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(3);
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toBe('正文\n\n\n');
  expect(markdown).not.toContain('<br');
  await open(page, markdown);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(3);
  await page.evaluate(() => window.trial.selectTextblock(2));
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文\n');
});

test('Shift Enter inserts a paragraph-internal line break, not another paragraph', async ({ page }) => {
  await open(page, '第一行\n');
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('第二行');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
  await expect(page.locator('.milkdown-editor > p')).toHaveText('第一行第二行');
  const markdown = await page.evaluate(() => window.trial.markdown());
  await open(page, markdown);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
  await expect(page.locator('.milkdown-editor > p br')).toHaveCount(1);
});

test('a source soft newline is visible while editing and stays a soft newline on save', async ({ page }) => {
  await open(page, '第一行\n第二行\n');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(1);
  await expect(page.locator('.milkdown-editor > p br[data-is-inline="true"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.trial.markdown())).toBe('第一行\n第二行\n');
});

test('an HTML block is editable locally and its source is saved without touching adjacent paragraphs', async ({ page }) => {
  await open(page, '<div>原内容</div>\n\n## 功能\n');
  await page.locator('.md-preview__html-block').hover();
  await page.getByRole('button', { name: /编辑 HTML|Edit HTML/ }).click();
  const input = page.getByRole('textbox', { name: /HTML 块内容|HTML block content/ });
  await input.fill('<p align="center">新内容</p>');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('<p align="center">新内容</p>\n\n## 功能\n');
  await input.press('Escape');
  await expect(input).toBeHidden();
  await expect(page.locator('.md-preview__html-block-preview')).toHaveText('新内容');
  await expect(page.locator('.milkdown-editor h2')).toHaveText('功能');
});

test('HTML edit controls use the shared theme and stay in the top right of the block', async ({ page }, testInfo) => {
  await open(page, '<div style="padding:32px;text-align:center">预览内容</div>\n\n## 功能\n');
  const block = page.locator('.md-preview__html-block');
  const button = page.locator('.md-preview__html-edit');
  await page.locator('.milkdown-editor h2').click();
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS('opacity', '0');
  await block.hover();
  await expect(button).toHaveCSS('opacity', '1');
  const parentBox = await block.boundingBox(); const buttonBox = await button.boundingBox();
  expect(buttonBox.x + buttonBox.width).toBeGreaterThan(parentBox.x + parentBox.width - 12);
  expect(buttonBox.y).toBeLessThan(parentBox.y + 12);
  await button.click();
  const input = page.locator('.md-preview__html-input');
  const panel = page.locator('.md-preview__html-panel');
  await expect(input).toBeFocused();
  const inputBox = await input.boundingBox(); const panelBox = await panel.boundingBox();
  expect(inputBox.width).toBeGreaterThan(panelBox.width * 0.95);
  await expect(input).toHaveCSS('padding-left', '16px');
  await expect(input).toHaveCSS('border-top-width', '0px');
  await expect(panel).toHaveCSS('border-top-width', '1px');
  await expect(panel).toHaveCSS('border-top-left-radius', '6px');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
    await page.screenshot({ path: testInfo.outputPath(`html-editor-${theme}.png`) });
    const textColor = await input.evaluate((el) => getComputedStyle(el).color);
    expect(textColor).not.toBe('rgb(0, 0, 0)');
  }
  await page.locator('.md-preview__html-done').click();
  await expect(input).toBeHidden();
  await expect(page.locator('.md-preview__html-block-preview')).toHaveText('预览内容');
});

test('an otherwise empty document also preserves intentional Enter presses across reopening', async ({ page }) => {
  await open(page, '');
  await page.locator('.milkdown-editor').click();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(3);
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toBe('\n\n');
  await open(page, markdown);
  await expect(page.locator('.milkdown-editor > p')).toHaveCount(3);
});

test('typing at the boundary after deleting an empty paragraph creates ordinary prose outside HTML', async ({ page }) => {
  const html = '<div>图片区域</div>';
  await open(page, `${html}\n\n\n## 功能\n`);
  await page.locator('.milkdown-editor > p').click(); await page.keyboard.press('Backspace');
  await page.keyboard.insertText('新的正文');
  await expect(page.locator('.milkdown-editor > p')).toHaveText('新的正文');
  await expect(page.locator('.milkdown-editor h2')).toHaveText('功能');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toContain(`${html}\n\n新的正文\n\n## 功能`);
  await open(page, markdown);
  await expect(page.locator('.milkdown-editor > p')).toHaveText('新的正文');
});
