import { test, expect } from '@playwright/test';

/** 打开脚手架、恢复默认键位，并等待面板渲染完成。 */
async function openPanel(page) {
  await page.goto('/tests/shortcut-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.setting-row');
  await page.evaluate(() => window.trial.reset());
}

/** 让某个动作进入录入状态，返回它的录入框。 */
async function startCapture(page, actionLabel) {
  const row = page.locator('.setting-row', { hasText: actionLabel }).first();
  const field = row.locator('.shortcut-input__field');
  await field.click();
  return field;
}

test('the shortcut panel lists every registered action with its current binding', async ({ page }) => {
  await openPanel(page);

  // 预览切换必须显示 Ctrl+Shift+/，并且面板按分组呈现。
  const previewRow = page.locator('.setting-row', { hasText: '切换编辑 / 预览' }).first();
  await expect(previewRow.locator('kbd')).toHaveText('Ctrl+Shift+/');
  await expect(page.locator('h3', { hasText: '文件' })).toBeVisible();
  await expect(page.locator('h3', { hasText: '编辑器' })).toBeVisible();
  expect(await page.locator('.shortcut-input__field').count()).toBe(11);
});

test('clicking a binding and pressing keys records the physical key', async ({ page }) => {
  await openPanel(page);

  const button = await startCapture(page, '全局搜索');
  await expect(button.locator('kbd')).toHaveText('请按组合键…');

  await page.keyboard.press('Control+Alt+KeyK');
  await expect(button.locator('kbd')).toHaveText('Ctrl+Alt+K');
  expect(await page.evaluate(() => window.trial.hotkeys().search)).toBe('Ctrl+Alt+KeyK');
});

test('capturing ignores plain modifier presses and reports why a combo is refused', async ({ page }) => {
  await openPanel(page);

  const button = await startCapture(page, '保存当前文件');
  // 只按修饰键不能绑定出残缺组合。
  await page.keyboard.down('Control');
  await expect(button.locator('kbd')).toHaveText('继续按主键…');
  await page.keyboard.up('Control');
  expect(await page.evaluate(() => window.trial.hotkeys().save)).toBe('Ctrl+KeyS');

  // 没有修饰键的字母键会吞掉正常输入。
  await page.keyboard.press('KeyQ');
  await expect(button.locator('kbd')).toContainText('Ctrl');
  expect(await page.evaluate(() => window.trial.hotkeys().save)).toBe('Ctrl+KeyS');

  // Escape 退出录入且不改变任何绑定。
  await page.keyboard.press('Escape');
  await expect(button.locator('kbd')).toHaveText('Ctrl+S');
});

test('a conflicting binding is refused and the key turns red, without any popup', async ({ page }) => {
  await openPanel(page);

  // 断言“不弹窗”是可验证的：整套脚手架里没有任何 toast 容器。
  await expect(page.locator('.toast, .notification-container, .ant-notification')).toHaveCount(0);

  const button = await startCapture(page, '切换侧边栏');
  // Ctrl+P 已被「全局搜索」占用。
  await page.keyboard.press('Control+KeyP');
  await expect(button.locator('kbd')).toHaveText('Ctrl+B');
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('Ctrl+KeyB');
  expect(await page.evaluate(() => window.trial.hotkeys().search)).toBe('Ctrl+KeyP');

  // 高亮落在快捷键本身：红色表示确定不可用。
  await expect(button.locator('kbd')).toHaveClass(/shortcut-input__kbd--error/);
});

test('a pre-existing duplicate binding turns both keys red', async ({ page }) => {
  await openPanel(page);

  // 模拟“旧配置/导入的配置里本来就重复”的情况：绕过校验直接写入 store。
  await page.evaluate(() => {
    window.trial.seedHotkeys({ save: 'Ctrl+KeyK', openFile: 'Ctrl+KeyK' });
  });
  const saveRow = page.locator('.setting-row', { hasText: '保存当前文件' }).first();
  const openRow = page.locator('.setting-row', { hasText: '打开文件' }).first();
  await expect(saveRow.locator('kbd')).toHaveClass(/shortcut-input__kbd--error/);
  await expect(openRow.locator('kbd')).toHaveClass(/shortcut-input__kbd--error/);
});

test('a combo the system already owns is reverted and the key turns red', async ({ page }) => {
  await openPanel(page);
  // 让原生探测“确认被占用”：浏览器里没有原生命令，只能注入。
  await page.evaluate(() => {
    window.trial.setProbe(async (keybinding) => (
      keybinding === 'Ctrl+Alt+KeyU' ? { status: 'taken' } : { status: 'available' }
    ));
  });

  const button = await startCapture(page, '切换侧边栏');
  await page.keyboard.press('Control+Alt+KeyU');

  // 值必须回滚：系统占用的组合不能留在配置里。
  await expect(button.locator('kbd')).toHaveText('Ctrl+B');
  await expect.poll(() => page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('Ctrl+KeyB');
  await expect(button.locator('kbd')).toHaveClass(/shortcut-input__kbd--error/);
});

test('a combo the native side confirms free turns the key green', async ({ page }) => {
  await openPanel(page);

  const button = await startCapture(page, '切换侧边栏');
  await page.keyboard.press('Control+Alt+KeyU');
  await expect(button.locator('kbd')).toHaveText('Ctrl+Alt+U');
  await expect.poll(() => page.evaluate(() => window.trial.hotkeys().toggleSidebar))
    .toBe('Ctrl+Alt+KeyU');
  // 原生确认可用 → 绿色，不再是“无反馈”。
  await expect(button.locator('kbd')).toHaveClass(/shortcut-input__kbd--ok/);
});

test('a known system combination is yellow while a merely unknown one stays neutral', async ({ page }) => {
  await page.goto('/tests/shortcut-harness.html?probe=unsupported');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.setting-row');
  await page.evaluate(() => window.trial.reset());

  // 已知清单命中（Ctrl+Shift+W 通常用于关闭窗口）→ 黄色：明确警告，但不阻断保存。
  const sidebar = page.locator('.setting-row', { hasText: '切换侧边栏' }).first()
    .locator('.shortcut-input__field');
  await sidebar.click();
  await page.keyboard.press('Control+Shift+KeyW');
  await expect(sidebar.locator('kbd')).toHaveText('Ctrl+Shift+W');
  expect(await page.evaluate(() => window.trial.hotkeys().toggleSidebar)).toBe('Ctrl+Shift+KeyW');
  await expect(sidebar.locator('kbd')).toHaveClass(/shortcut-input__kbd--warning/);

  // 未命中清单但同样探测不到（Ctrl+B）→ 中性，而不是黄色或绿色。
  const search = page.locator('.setting-row', { hasText: '全局搜索' }).first()
    .locator('.shortcut-input__field');
  await expect(search.locator('kbd')).toHaveClass(/shortcut-input__kbd--unknown/);
});

test('a saved key is neutral, not green, when the system verdict is unknown', async ({ page }) => {
  // 用 URL 参数在页面脚本运行前就设定“探测不到”，避免改探针的时序竞态。
  await page.goto('/tests/shortcut-harness.html?probe=unsupported');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.setting-row');
  await page.evaluate(() => window.trial.reset());
  const button = page.locator('.setting-row', { hasText: '切换侧边栏' }).first().locator('.shortcut-input__field');
  // 没有命中已知系统清单、也无法探测 → 中性“未验证”。
  // 关键：不能是绿色，否则用户会把“没验证过”当成“确认可用”。
  await expect(button.locator('kbd')).toHaveClass(/shortcut-input__kbd--unknown/);
  await expect(button.locator('kbd')).not.toHaveClass(/shortcut-input__kbd--ok/);
});

test('a key that is natively confirmed free is green, not neutral', async ({ page }) => {
  await page.goto('/tests/shortcut-harness.html?probe=available');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.setting-row');
  await page.evaluate(() => window.trial.reset());
  const button = page.locator('.setting-row', { hasText: '切换侧边栏' }).first().locator('.shortcut-input__field');
  await expect(button.locator('kbd')).toHaveClass(/shortcut-input__kbd--ok/);
});

test('the tooltip carries the detail instead of a permanent description line', async ({ page }) => {
  await openPanel(page);
  const row = page.locator('.setting-row', { hasText: '切换侧边栏' }).first();
  await row.locator('.shortcut-input__field').hover();
  const tooltip = page.locator('.ant-tooltip-inner').first();
  await expect(tooltip).toContainText('确认');
});

test('hovering the reset control shows only its own tooltip, kept inside the panel', async ({ page }) => {
  await openPanel(page);
  const row = page.locator('.setting-row', { hasText: '切换侧边栏' }).first();
  await row.locator('.shortcut-input__field').click();
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(row.locator('.shortcut-input__kbd')).toHaveText('Ctrl+Shift+Z');

  // 重置按钮是录入框的子元素，悬停它时外层 tooltip 必须让位，否则两个会同时挂着。
  await row.locator('.shortcut-input__reset').hover();
  await expect(page.locator('.ant-tooltip-inner', { hasText: '恢复该动作的默认键位' })).toHaveCount(1);
  await expect(page.locator('.ant-tooltip-inner', { hasText: '确认' })).toHaveCount(0);
  // 提示右边缘与输入框对齐（不再锚在那个贴右的小按钮上）。
  const geometry = await row.evaluate((el) => {
    const fieldBox = el.querySelector('.shortcut-input__field').getBoundingClientRect();
    const tipEl = [...document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)')]
      .find((tip) => tip.textContent?.includes('恢复该动作的默认键位'));
    if (!tipEl) return null;
    const tipBox = tipEl.getBoundingClientRect();
    return {
      // 对齐到框右边缘：允许提示因文字更宽而向左延伸，但右侧不该明显越出。
      deltaRight: Math.round(tipBox.right - fieldBox.right),
    };
  });
  expect(geometry).not.toBeNull();
  // 真实弹窗里是精确对齐（差值 0）；脚手架环境 antd 会多偏移几像素，属环境差异。
  // 这条断言要能区分“环境微调”和“锚错元素”：锚在小按钮上时偏差是几十像素。
  expect(geometry.deltaRight).toBeLessThanOrEqual(10);
});

test('every listed key carries a status colour, never a bare default', async ({ page }) => {
  await openPanel(page);
  // 回归点：探测是异步返回的，面板首屏曾经出现“前面几个已上色、后面几个还是黑色”。
  // 每个快捷键在任何时刻都必须带一个状态类，不允许继承默认颜色。
  const report = await page.evaluate((ids) => {
    const rows = ids.map((actionId) => actionId);
    void rows;
    return [...document.querySelectorAll('.setting-row kbd')].map((kbd) => ({
      text: kbd.textContent,
      className: kbd.className,
      coloured: /shortcut-input__kbd--(ok|warning|error|unknown)/.test(kbd.className),
    }));
  }, []);
  expect(report.length).toBeGreaterThan(0);
  expect(report.filter((item) => !item.coloured)).toEqual([]);
  // 并且功能键（F1 / F11）不能是例外——它们正是当初漏色的两项。
  for (const text of ['F1', 'F11']) {
    const row = report.find((item) => item.text === text);
    expect({ text, coloured: row?.coloured }).toEqual({ text, coloured: true });
  }
});
test('no raw translation keys leak into the panel', async ({ page }) => {
  await openPanel(page);
  // 漏配文案时 i18next 会把键名原样显示出来（例如 settings.shortcuts.howTo）。
  // 这里对整个面板做一次扫描，让这类问题在测试里暴露而不是在用户界面上。
  const text = await page.locator('.shortcuts-settings').innerText();
  const rawKeys = text.match(/\b(?:settings|editor|toolbar|sidebar|drag|notification)\.[a-zA-Z][\w.]*/g) ?? [];
  expect(rawKeys).toEqual([]);
});

test('clearing a binding disables it, and the reset control restores the default', async ({ page }) => {
  await openPanel(page);

  const field = await startCapture(page, '打开设置');
  await page.keyboard.press('Backspace');
  await expect(field.locator('kbd')).toHaveText('未绑定');
  expect(await page.evaluate(() => window.trial.hotkeys().openSettings)).toBe('');

  // 此时已不是默认值，框内的重置按钮应当出现。
  const reset = page.locator('.setting-row', { hasText: '打开设置' }).first().locator('.shortcut-input__reset');
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(field.locator('kbd')).toHaveText('Ctrl+,');
  expect(await page.evaluate(() => window.trial.hotkeys().openSettings)).toBe('Ctrl+Comma');
});

test('the reset control lives inside the field and is absent at the default value', async ({ page }) => {
  await openPanel(page);

  const row = page.locator('.setting-row', { hasText: '切换侧边栏' }).first();
  const field = row.locator('.shortcut-input__field');

  // 默认值下没有可恢复的东西，不渲染重置按钮，而且键位必须仍居中：
  // 之前用单侧 padding 给按钮留位，导致没有按钮时文字偏左（真实回归）。
  await expect(row.locator('.shortcut-input__reset')).toHaveCount(0);
  const offsetWithoutReset = await row.evaluate((el) => {
    const fieldBox = el.querySelector('.shortcut-input__field').getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('.shortcut-input__kbd'));
    const textBox = range.getBoundingClientRect();
    return (textBox.left + textBox.width / 2) - (fieldBox.left + fieldBox.width / 2);
  });
  expect(Math.abs(offsetWithoutReset)).toBeLessThanOrEqual(2);

  // 改成非默认值后出现，且必须位于录入框内部（而不是框外旁边）。
  // 特意用较长的组合，覆盖“长键位 + 按钮”这个最容易挤在一起的边界。
  await field.click();
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(field.locator('kbd')).toHaveText('Ctrl+Shift+Z');
  const reset = row.locator('.shortcut-input__reset');
  await expect(reset).toBeVisible();
  expect(await reset.evaluate((el) => el.closest('.shortcut-input__field') !== null)).toBe(true);
  // 几何复核：键位仍居中、按钮贴在框右内侧、且没有压住键位文字。
  // （重置按钮是绝对定位浮层，所以不能用“两个盒子的 rect 比较”判断重叠，
  //   键位元素的 rect 本身就占满整行；必须量文字实际范围。）
  const geometry = await row.evaluate((el) => {
    const fieldBox = el.querySelector('.shortcut-input__field').getBoundingClientRect();
    const resetBox = el.querySelector('.shortcut-input__reset').getBoundingClientRect();
    const kbdEl = el.querySelector('.shortcut-input__kbd');
    const range = document.createRange();
    range.selectNodeContents(kbdEl);
    const textBox = range.getBoundingClientRect();
    return {
      // 键位文字中心相对框中心的偏移，0 表示居中
      kbdOffset: Math.abs((textBox.left + textBox.width / 2) - (fieldBox.left + fieldBox.width / 2)),
      // 按钮右边缘到框右边缘的距离，越小越贴右
      gapRight: fieldBox.right - resetBox.right,
      inside: resetBox.left >= fieldBox.left && resetBox.right <= fieldBox.right + 1,
      textOverlap: textBox.right > resetBox.left + 1,
    };
  });
  expect(geometry.kbdOffset).toBeLessThanOrEqual(2);
  expect(geometry.gapRight).toBeLessThanOrEqual(12);
  expect(geometry.inside).toBe(true);
  expect(geometry.textOverlap).toBe(false);

  // 点击它不要顺带触发录入（stopPropagation）。
  await reset.click();
  await expect(field.locator('kbd')).toHaveText('Ctrl+B');
  await expect(row.locator('.shortcut-input__reset')).toHaveCount(0);
});
