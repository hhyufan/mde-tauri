/**
 * Monaco ? Shiki ???????
 *
 * ????????????????????????????????
 */
import * as monaco from 'monaco-editor';

/**
 * 预加载的 Shiki 语言列表。
 *
 * 仅覆盖编辑器里高频出现的语言，避免初始化时加载过多无关语法定义。
 */
const SHIKI_LANGS = [
  'markdown', 'javascript', 'typescript', 'json', 'html', 'css', 'scss',
  'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
  'shell', 'yaml', 'xml', 'sql', 'lua', 'kotlin', 'swift', 'vue', 'svelte',
  'toml', 'powershell', 'ini',
];

let shikiReady = false;
let shikiInitPromise = null;

/**
 * 初始化 Monaco 与 Shiki 的主题桥接。
 *
 * 整个过程只执行一次；失败时回退到 Monaco 内置主题，不阻塞编辑器可用性。
 */
export async function initMonacoShiki() {
  if (shikiReady) return;
  if (shikiInitPromise) return shikiInitPromise;
  shikiInitPromise = (async () => {
    try {
      const { createHighlighter } = await import('shiki');
      const { shikiToMonaco } = await import('@shikijs/monaco');
      const highlighter = await createHighlighter({
        themes: ['one-dark-pro', 'one-light'],
        langs: SHIKI_LANGS,
      });
      shikiToMonaco(highlighter, monaco);
      shikiReady = true;
    } catch (err) {
      // 初始化失败时保留 Monaco 原生主题能力，避免影响主编辑流程。
      console.warn('Shiki initialization failed, falling back to built-in themes:', err);
    }
  })();
  return shikiInitPromise;
}

/**
 * 判断 Shiki 主题桥接是否已经可用。
 */
export function isMonacoShikiReady() {
  return shikiReady;
}

/**
 * 根据当前主题模式返回实际应使用的 Monaco 主题名。
 */
export function getMonacoThemeName(isDark) {
  if (shikiReady) {
    return isDark ? 'one-dark-pro' : 'one-light';
  }
  return isDark ? 'vs-dark' : 'vs';
}
