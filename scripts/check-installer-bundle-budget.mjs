/**
 * 安装器的入口体积门。
 *
 * 为什么需要：安装器的宣传页现在直接渲染应用的真实组件（FeatureScenes 引
 * src/components/ui/FileTypeIcon、src/utils/mgtree 等），于是 antd、ReactMarkdown、
 * 甚至 Milkdown 都进了安装器的包（主 chunk 从 172 kB 涨到 ~1 MB）。
 *
 * 这个代价本身是合理的（换掉了手绘假图，宣传页永远不会和产品不一致），但必须有人
 * 看着它——否则下一次"顺手再引一个真组件"没人会注意到。应用侧有 check:bundle，
 * 安装器侧一直没有任何门。
 *
 * 注意这不是 gzip 数字，是产物原始大小；与应用侧的 check-bundle-budget 保持一致口径。
 * 预算与应用侧同取 700 KiB：当前入口约 510 KiB，留出约 190 KiB 余量——够正常的微调，
 * 但"再顺手引一个重型真组件"会被拦下来。
 */
import { readFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BUDGET_KIB = 700;

const distDir = fileURLToPath(new URL('../installer/dist/', import.meta.url));
const html = await readFile(join(distDir, 'index.html'), 'utf8');
const match = html.match(/<script[^>]+src="\/?assets\/([^"]+\.js)"/);
if (!match)
  throw new Error('Could not resolve the JavaScript entry from installer/dist/index.html');

const entry = match[1];
const { size } = await stat(join(distDir, 'assets', entry));
const budget = BUDGET_KIB * 1024;

// 顺带报出全部 JS 总量（含懒加载块）：只盯入口会漏掉"把东西挪进懒加载"这种规避
const files = (await readdir(join(distDir, 'assets'))).filter((name) => name.endsWith('.js'));
let total = 0;
for (const name of files) total += (await stat(join(distDir, 'assets', name))).size;

const summary = `安装器入口 ${(size / 1024).toFixed(1)} KiB / ${BUDGET_KIB} KiB（全部 JS ${(total / 1024).toFixed(1)} KiB，${files.length} 块）`;
if (size > budget) {
  throw new Error(`${summary} —— 超出预算，请确认新引入的依赖是否必要`);
}
console.log(`Installer bundle budget passed: ${summary}`);
