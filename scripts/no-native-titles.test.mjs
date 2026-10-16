/**
 * 守卫：不允许在原生 DOM 标签上用 title 属性。
 *
 * 为什么：原生 title 走的是系统级提示——出现慢、样式不受应用控制，和统一使用的
 * antd Tooltip 观感不一致。需要提示的地方应写 <Tooltip title=...>。
 *
 * 实现：用 @babel/parser 解析 JSX 拿到 AST，只看真的落在元素属性上的 title。
 * （不要用文本回溯：prop 里嵌 JSX 时，例如 icon={<Plus />}，回溯会错误地取到内层标签名。）
 *
 * 判据：开始标签名首字母小写 或 带连字符 => 原生标签；首字母大写的是组件，
 * 它们要么本身就是 Tooltip，要么把 title 当语义 prop（如 Modal、Card）。
 * 例外：antd 的 Button / Icon 没有 title 语义，会原样透传到 DOM，单独点名。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';

/** 会把 title 原样透传到 DOM 的组件。 */
const DOM_PASSTHROUGH = new Set(['Button', 'Icon']);

function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...jsxFiles(path));
    else if (entry.endsWith('.jsx')) out.push(path);
  }
  return out;
}

const isIntrinsic = (name) => /^[a-z]/.test(name) || name.includes('-');

/** 深度优先遍历 AST 节点。 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk(node[key], visit);
  }
}

/** 返回源码里所有「title 落在原生标签上」的位置。 */
export function findNativeTitles(source, filename = 'inline.jsx') {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining'],
  });
  const found = [];
  walk(ast, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    const nameNode = node.name;
    if (nameNode?.type !== 'JSXIdentifier') return; // Foo.Bar 这类按组件处理
    const name = nameNode.name;
    if (name === 'Tooltip') return;
    if (!isIntrinsic(name) && !DOM_PASSTHROUGH.has(name)) return;
    const hasTitle = node.attributes.some(
      (attr) => attr.type === 'JSXAttribute' && attr.name?.name === 'title',
    );
    if (hasTitle) found.push({ line: node.loc.start.line, tag: name, filename });
  });
  return found;
}

test('原生 DOM 标签上不再使用 title 属性', () => {
  const offenders = [];
  for (const file of jsxFiles('src')) {
    for (const hit of findNativeTitles(readFileSync(file, 'utf8'), file)) {
      offenders.push(`${file}:${hit.line} <${hit.tag}>`);
    }
  }
  assert.deepEqual(offenders, [], `这些地方应改用 <Tooltip title=...>：\n${offenders.join('\n')}`);
});

test('守卫本身能识别出违规写法（避免它悄悄失效）', () => {
  assert.deepEqual(
    findNativeTitles('<span title="x">a</span>').map((h) => h.tag),
    ['span'],
  );
  assert.deepEqual(findNativeTitles('<Tooltip title="x"><span>a</span></Tooltip>'), []);
  // prop 里嵌 JSX：回溯式实现会在这里误判成 Plus
  assert.deepEqual(
    findNativeTitles('<Button icon={<Plus />} title="x" />').map((h) => h.tag),
    ['Button'],
  );
  // 组件的 title 是语义 prop，不算违规
  assert.deepEqual(findNativeTitles('<Modal title="x" />'), []);
  assert.deepEqual(findNativeTitles('const a = 1;'), []);
});
