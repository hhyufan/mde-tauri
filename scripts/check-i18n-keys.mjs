/**
 * 中英文案完整性检查。
 *
 * 两类问题在这里拦下：
 *  1. 两个语言文件的键不一致（漏翻译）。
 *  2. 代码里引用了不存在的键——`t('x.y')` 找不到时 i18next 会把键名原样显示到
 *     界面上（例如按钮上出现 `settings.shortcuts.howTo`），这类问题靠肉眼很容易漏。
 *
 * 只检查字面量键；模板拼接（`` t(`a.${b}`) ``）无法静态解析，按前缀豁免。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = {
  zh: JSON.parse(readFileSync(join(root, 'src/i18n/locales/zh_cn.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(root, 'src/i18n/locales/en_us.json'), 'utf8')),
};

/** 递归收集待检查的源码文件。 */
function collectFiles(directory, collected = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      collectFiles(path, collected);
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.(js|jsx)$/.test(entry)) {
      collected.push(path);
    }
  }
  return collected;
}

const problems = [];

// 1. 两个语言文件的键必须完全一致。
const zhKeys = new Set(Object.keys(LOCALES.zh));
const enKeys = new Set(Object.keys(LOCALES.en));
for (const key of zhKeys) if (!enKeys.has(key)) problems.push(`en_us.json 缺少键：${key}`);
for (const key of enKeys) if (!zhKeys.has(key)) problems.push(`zh_cn.json 缺少键：${key}`);

// 2. 代码里引用的字面量键必须存在。
const quoted = /(?<![\w.])t\(\s*(['"])([A-Za-z][\w.]*)\1/g;
const referenced = new Set();
for (const file of collectFiles(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(quoted)) {
    referenced.add(`${match[2]}\u0000${relative(root, file).split(sep).join('/')}`);
  }
}
for (const entry of referenced) {
  const [key, file] = entry.split('\u0000');
  if (!zhKeys.has(key)) problems.push(`${file} 引用了不存在的键：${key}`);
}

if (problems.length > 0) {
  console.error(`文案检查未通过（${problems.length} 项）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`文案检查通过：zh/en 各 ${zhKeys.size} 条，代码引用 ${referenced.size} 处均存在`);
