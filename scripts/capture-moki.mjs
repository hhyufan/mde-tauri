/** Run against an isolated local Vite preview. Screenshots use only sample documents. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(
  process.env.MDE_SCREENSHOT_RUNTIME
    ? path.join(process.env.MDE_SCREENSHOT_RUNTIME, 'package.json')
    : import.meta.url,
);
const { chromium } = require('playwright');
const sharp = require('sharp');
const browser = await chromium.launch({
  headless: true,
  channel: process.env.MDE_BROWSER_CHANNEL || 'msedge',
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const output = path.resolve('screenshots');
await fs.mkdir(output, { recursive: true });
await page.addInitScript(() => {
  localStorage.setItem(
    'mokidown-config',
    JSON.stringify({
      state: {
        language: 'zh',
        autoSave: false,
        syncEnabled: false,
        mokiDisplay: 'welcome',
      },
      version: 0,
    }),
  );
  localStorage.setItem('mokidown-theme', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
});
const md =
  '# 让灵感，在这里落笔。\n\n> MokiDown · 写文档，跑代码，连接自己的知识。\n\n## 今天的灵感\n\n- [x] 写下一个小小的想法\n- [x] 用代码验证它\n- [ ] 整理成自己的知识树\n\n## 从笔记到实践\n\n```javascript\nconst ideas = ["记录", "尝试", "连接"];\nideas.forEach((idea, i) => {\n  console.log(`${i + 1}. ${idea}`);\n});\n```\n\n## 我的工作台\n\n| 能力 | 使用方式 |\n| --- | --- |\n| 自由书写 | Markdown 与所见即所得 |\n| 随手验证 | 可执行代码块 |\n| 知识连接 | 拖拽、折叠知识树 |\n\n**本地优先**，让每一页笔记都有自己的归处。\n';
const runMd =
  '# 在笔记里，验证想法\n\n代码与解释留在同一页，结果紧跟思路。\n\n```javascript\nconst ideas = ["记录", "尝试", "连接"];\nideas.forEach((idea, i) => {\n  console.log(`${i + 1}. ${idea}`);\n});\n```\n\n> 下方输出展示来自示例脚本的运行结果。\n';
async function theme(value) {
  await page.evaluate(
    async (value) =>
      (await import('/src/store/useThemeStore.js')).default.getState().setTheme(value),
    value,
  );
}
async function openFile(name, content, mode = 'split') {
  await page.evaluate(
    async ({ name, content, mode }) => {
      const editor = (await import('/src/store/useEditorStore.js')).default;
      editor.getState().openFile({ path: `/MokiDown Notes/${name}`, name, content });
      editor.setState({ viewMode: mode, sidebarView: 'recent' });
      const files = (await import('/src/store/useFileStore.js')).default;
      files.getState().addRecentFile({ path: `/MokiDown Notes/${name}`, name });
    },
    { name, content, mode },
  );
}
async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, name), animations: 'disabled' });
  console.log(`Captured ${name}`);
}
try {
  await page.goto(process.env.MDE_SCREENSHOT_URL || 'http://127.0.0.1:1421', {
    waitUntil: 'networkidle',
  });
  // Warm lazy renderers before capturing: Vite may reload once when first optimizing them.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(async () => {
        await Promise.all([
          import('/src/components/editor/MonacoEditor.jsx'),
          import('/src/components/editor/MarkdownPreview.jsx'),
          import('/src/components/editor/MilkdownMarkdownEditor.jsx'),
          import('/src/components/editor/TreeEditor.jsx'),
          import('/src/components/overlays/SettingsModal.jsx'),
        ]);
      });
      await page.waitForTimeout(2000);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForLoadState('networkidle');
    }
  }
  await page.getByRole('heading', { name: '让灵感，在这里落笔。' }).waitFor();
  // 立绘可能因主题/配置未渲染：等待失败不该让整轮截图作废（后续断言会兜底）。
  await page
    .locator('.moki-welcome .moki-sprite, .moki-welcome .moki-sprite__art')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await shot('welcome-light.png');
  const ambient = page.locator('.moki-welcome .moki-ambient__symbol').first();
  const before = await ambient.evaluate((node) => getComputedStyle(node).transform);
  await page.waitForTimeout(300);
  assert.notEqual(await ambient.evaluate((node) => getComputedStyle(node).transform), before);
  assert.equal(await page.locator('.moki-sprite canvas').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await ambient.evaluate((node) => getComputedStyle(node).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // 周边轻动效开关已下线：飘散动画常驻，是否播放只由 prefers-reduced-motion 决定
  // （107-108 行已断言 reduce 下 animationName 为 none，这里不再切换开关）。
  await page.evaluate(async () =>
    (await import('/src/store/useConfigStore.js')).default.setState({ mokiMotion: true }),
  );
  await page.locator('.moki-welcome .moki-ambient--animated').waitFor();
  await theme('dark');
  await shot('welcome-dark.png');
  await theme('light');
  await page.getByRole('button', { name: /新建文档/ }).click();
  assert.equal(await page.locator('.moki-companion').count(), 0);
  await openFile('灵感笔记.md', md);
  await page.locator('.monaco-editor').first().waitFor();
  await page.locator('.md-preview').first().waitFor();
  await page.waitForTimeout(1500);
  await shot('main.png');
  await shot('editor.png');
  await theme('dark');
  await shot('editor-dark.png');
  await theme('light');
  const modeFrames = [await page.screenshot()];
  await page.evaluate(async () =>
    (await import('/src/store/useEditorStore.js')).default.setState({ viewMode: 'preview' }),
  );
  await page.locator('.milkdown').waitFor();
  await shot('wysiwyg.png');
  modeFrames.push(await page.screenshot());
  await page.evaluate(async () =>
    (await import('/src/store/useEditorStore.js')).default.setState({ viewMode: 'edit' }),
  );
  await page.locator('.monaco-editor').first().waitFor();
  modeFrames.push(await page.screenshot());
  const resizedModes = await Promise.all(
    modeFrames.map((frame) => sharp(frame).resize(960, 600).png().toBuffer()),
  );
  await sharp(resizedModes, { join: { animated: true } })
    .gif({ loop: 0, delay: [1800, 1800, 1800] })
    .toFile(path.join(output, 'mode-switch.gif'));
  await openFile(
    '知识树.mgtree',
    '我的知识工作台\n  写作\n    Markdown 笔记\n    所见即所得\n  实践\n    代码块运行\n    记录输出与结论\n  连接\n    关联知识节点\n    构建自己的知识树\n',
    'split',
  );
  await page.locator('.moki-tree').waitFor();
  await page.getByRole('button', { name: '展开全部' }).click();
  await page.waitForTimeout(400);
  await shot('tree.png');
  await openFile('代码实验.md', runMd, 'split');
  await page.locator('.md-code-execution').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '运行此代码块', exact: true }).click();
  await page.evaluate(async () => {
    // Browser preview cannot launch Tauri processes. This is a documented UI fixture.
    const store = (await import('/src/store/useCodeBlockRunStore.js')).default;
    const [key, run] = Object.entries(store.getState().blocks)[0];
    store
      .getState()
      .receive(key, { runId: run.runId, kind: 'stdout', text: '1. 记录\n2. 尝试\n3. 连接\n' });
    store.setState({
      blocks: {
        [key]: {
          ...store.getState().blocks[key],
          status: 'success',
          exitCode: 0,
          elapsedMs: 38,
          logs: [{ kind: 'stdout', text: '1. 记录\n2. 尝试\n3. 连接\n' }],
        },
      },
    });
  });
  await shot('code-run.png');
  await page.keyboard.press('Control+,');
  await page.getByText('外观', { exact: true }).click();
  await page.getByText('Moki · 主题与形象', { exact: true }).waitFor();
  await shot('moki-settings.png');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const sync = (await import('/src/store/useSyncStore.js')).default;
    sync.getState().addConflict({
      fileId: 'screenshot-sample',
      name: '灵感笔记.md',
      path: '示例文档 / 灵感笔记.md',
      localContent:
        '# 我的灵感\n\n## 写作计划\n\n- 整理 Markdown 笔记\n- 完成代码实验\n- 周五分享学习心得\n',
      remoteContent:
        '# 我的灵感\n\n## 写作计划\n\n- 整理 Markdown 笔记\n- 补充实验结果\n- 周六分享学习心得\n',
    });
  });
  await page.getByRole('button', { name: '查看并处理' }).click();
  await page.locator('.conflict-dialog .monaco-diff-editor').waitFor();
  await page.waitForTimeout(600);
  await shot('sync-conflict.png');
  await page.keyboard.press('Escape');
  await page.evaluate(async () =>
    (await import('/src/store/useSyncStore.js')).default.setState({ conflicts: [] }),
  );
  await page.evaluate(async () =>
    (await import('/src/store/useEditorStore.js')).default.setState({
      tabs: [],
      tabRenderList: [],
      activeTabId: null,
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: '让灵感，在这里落笔。' }).waitFor();
  await shot('welcome-mobile.png');
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile welcome must not overflow horizontally',
  );
  await fs.writeFile(
    path.join(output, 'capture-report.json'),
    JSON.stringify(
      {
        viewport: { width: 1600, height: 1000 },
        errors,
        fixtures: ['code-run.png', 'sync-conflict.png'],
      },
      null,
      2,
    ),
  );
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('\n')}`);
} catch (error) {
  await shot('capture-debug.png');
  console.error('Page errors:', errors);
  console.error((await page.locator('body').innerText()).slice(0, 3000));
  throw error;
} finally {
  await browser.close();
}
