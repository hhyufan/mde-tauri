import { test, expect } from '@playwright/test';
import { inflateSync } from 'node:zlib';

/**
 * 分屏预览的代码块底色一致性。
 *
 * 回归点：可运行代码块的外层容器曾用 `--bg`，而代码区用 `--md-code-bg`，
 * 两者在暗色下色差明显（纯黑 vs 蓝调半透明），表现为代码块上下各多出一条背景色。
 * 这里覆盖四种主题/背景图组合——背景图模式在 background-surfaces.scss 里会
 * 对同一批元素再定义一次底色，正是漏测它才导致“改了却看不出效果”。
 */
const COMBINATIONS = [
  { theme: 'light', background: false },
  { theme: 'dark', background: false },
  { theme: 'light', background: true },
  { theme: 'dark', background: true },
];

for (const { theme, background } of COMBINATIONS) {
  test(`runnable code block shares the code surface (${theme}${background ? ' + background image' : ''})`, async ({ page }) => {
    page.on('pageerror', (error) => console.log('[pageerror]', error.message));
    await page.goto('/tests/preview-harness.html');
    await page.waitForFunction(() => window.trial);
    await page.waitForSelector('.md-runnable-code pre');
    await page.evaluate((options) => window.trial.apply(options), { theme, background });
    await page.waitForTimeout(150);

    const surfaces = await page.evaluate(() => window.trial.surfaces());
    // 真实结构必须存在，否则这条用例什么都没测到。
    expect(surfaces.hasRunnable).toBe(true);
    expect(surfaces.hasRunToolbar).toBe(true);
    // 容器底色必须与代码区一致；pre/code 保持透明，避免叠出第二层色。
    expect(surfaces.runnableWrapper).toBe(surfaces.plainPre);
    expect(surfaces.runnablePre).toBe('rgba(0, 0, 0, 0)');
    expect(surfaces.runnableCode).toBe('rgba(0, 0, 0, 0)');
    if (background) expect(surfaces.highlightedPre).toBe(surfaces.plainPre);
    expect(surfaces.highlightedCode).toBe('rgba(0, 0, 0, 0)');
    expect(surfaces.inlineCode).not.toBe('rgba(0, 0, 0, 0)');
  });
}

test('the code surface stays a single flat colour from top to bottom', async ({ page }) => {
  await page.goto('/tests/preview-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.waitForSelector('.md-runnable-code pre');
  await page.evaluate(() => window.trial.apply({ theme: 'dark', background: false }));
  await page.waitForTimeout(150);

  // 在容器左侧留白处（避开文字）竖向取一行像素，整条必须是同一个颜色。
  const cdp = await page.context().newCDPSession(page);
  const box = await page.evaluate(() => {
    const rect = document.querySelector('.md-runnable-code').getBoundingClientRect();
    return { x: Math.round(rect.left) + 3, y: Math.round(rect.top), width: 2, height: Math.round(rect.height) };
  });
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: 1 },
  });
  const png = decodePng(Buffer.from(data, 'base64'));
  const colors = new Set();
  for (let y = 2; y < png.height - 2; y += 1) {
    const i = y * png.width * png.channels;
    colors.add(`${png.pixels[i]},${png.pixels[i + 1]},${png.pixels[i + 2]}`);
  }
  // 去掉首尾各 2 行避开圆角与边框，中间必须是纯色。
  expect([...colors]).toHaveLength(1);
});

/** 极简 PNG 解码：8 位、非隔行、RGB/RGBA。 */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels };
}
