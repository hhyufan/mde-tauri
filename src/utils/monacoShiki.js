import * as monaco from 'monaco-editor';

const SHIKI_LANGS = [
  'markdown', 'javascript', 'typescript', 'json', 'html', 'css', 'scss',
  'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
  'shell', 'yaml', 'xml', 'sql', 'lua', 'kotlin', 'swift', 'vue', 'svelte',
  'toml', 'powershell', 'ini',
];

let shikiReady = false;
let shikiInitPromise = null;

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
      // eslint-disable-next-line no-console
      console.warn('Shiki initialization failed, falling back to built-in themes:', err);
    }
  })();
  return shikiInitPromise;
}

export function isMonacoShikiReady() {
  return shikiReady;
}

export function getMonacoThemeName(isDark) {
  if (shikiReady) {
    return isDark ? 'one-dark-pro' : 'one-light';
  }
  return isDark ? 'vs-dark' : 'vs';
}
