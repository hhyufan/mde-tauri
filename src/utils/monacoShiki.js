/**
 * Monaco syntax-highlighting bootstrap.
 *
 * Highlighting is provided by Shiki: real TextMate grammars for every language
 * the app can open, coloured by the One Dark Pro / One Light themes.
 *
 * Why TextMate matters here: Monaco's own Markdown support is a Monarch lexer,
 * which only understands Markdown punctuation — the code inside ``` fenced
 * blocks stays flat and uncoloured. Shiki installs TextMate tokenizers, so
 * embedded grammars highlight the code inside fences exactly like the One
 * Dark / One Light themes do in an editor.
 *
 * Ordering is the whole point of this module. `shikiToMonaco()` both installs
 * the tokenizers and monkey-patches `monaco.editor.setTheme` / `.create`, and
 * Shiki's tokenizer derives Monaco token types from the *currently active*
 * Shiki theme. If an editor is created before that patch is in place — which is
 * what used to happen, because the highlighter takes a while to load and the
 * editor was mounted first — the editor keeps Monaco's Monarch tokenizers and
 * unpainted tokens. `prepareMonacoRuntime()` therefore resolves this module
 * before `MonacoEditor` is even imported, so the patch and the tokenizers are
 * always in place before the first editor exists.
 */
import * as monaco from 'monaco-editor';
import { registerMgtreeLanguage, treeTokenRules } from './mgtreeLanguage';
import { disableBundledLanguageServices } from './monacoBuiltinServices';

/** Theme identifiers referenced by `MonacoEditor` and persisted UI state. */
export const LIGHT_THEME_NAME = 'one-light';
export const DARK_THEME_NAME = 'one-dark-pro';

/**
 * Shiki 语法包列表。
 *
 * 仅覆盖编辑器里会出现的语言，避免初始化时加载无关语法定义。Monaco 没有注册
 * 的语言（例如 vue / svelte / toml）由 `shikiToMonaco` 自动跳过，因此不在此列。
 */
const SHIKI_LANGS = [
  'markdown', 'javascript', 'typescript', 'json', 'html', 'css', 'scss',
  'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
  'shell', 'yaml', 'xml', 'sql', 'lua', 'kotlin', 'swift', 'powershell', 'ini',
];

// Monaco keeps Shiki's patched methods across Vite module replacement. Keep its
// readiness and single initialization task on the same instance as those methods.
const RUNTIME_KEY = Symbol.for('mde.monaco.shiki.runtime');
const runtime = monaco.editor[RUNTIME_KEY] ||= {
  ready: false, promise: null,
  create: monaco.editor.create, setTheme: monaco.editor.setTheme,
};
function normalizeThemeName(name) {
  if ([LIGHT_THEME_NAME, 'vs', 'hc-light'].includes(name)) return LIGHT_THEME_NAME;
  if ([DARK_THEME_NAME, 'vs-dark', 'hc-black'].includes(name)) return DARK_THEME_NAME;
  return readPreferredThemeName();
}
const fallbackSetTheme = (name) => runtime.setTheme(normalizeThemeName(name));
const fallbackCreate = (element, options, overrides) => runtime.create(element,
  { ...options, theme: normalizeThemeName(options?.theme) }, overrides);
if (!runtime.ready) {
  // These names stay safe even when Shiki cannot load. Never send `vs` to a
  // previously patched Shiki setter during hot replacement.
  for (const [name, dark] of [[LIGHT_THEME_NAME, false], [DARK_THEME_NAME, true]]) {
    monaco.editor.defineTheme(name, { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: treeTokenRules(dark) });
  }
  monaco.editor.setTheme = fallbackSetTheme;
  monaco.editor.create = fallbackCreate;
}

/**
 * Shiki 主题名 → 是否深色。
 *
 * @param {string} themeName Monaco/Shiki 主题名。
 * @returns {boolean} 深色主题时为 true。
 */
function isDarkTheme(themeName) {
  return themeName === DARK_THEME_NAME;
}

/**
 * 读取当前应使用的主题名（浅色为默认值）。
 *
 * @returns {string} 主题名。
 */
function readPreferredThemeName() {
  const theme = typeof document !== 'undefined' ? document.documentElement.dataset.theme : '';
  return theme === 'dark' ? DARK_THEME_NAME : LIGHT_THEME_NAME;
}

/**
 * 给 Shiki 生成的主题补上 `mgtree` 的配色规则。
 *
 * `mgtree` 是本应用自定义语言，不属于 Shiki，它由 `registerMgtreeLanguage` 的
 * Monarch 分词器提供 token，因此必须有自己的主题规则，否则这棵树的层级颜色会丢。
 *
 * 同时把 `inherit` 打开：Shiki 的 TextMate 主题只描述语法色，缺少 `--vscode-*`
 * 这类控件变量，完全继承会导致查找框、悬浮提示的前景色变成透明。
 *
 * @param {string} themeName 主题名。
 * @param {object} monacoTheme `textmateThemeToMonacoTheme` 的转换结果。
 * @returns {object} 可直接交给 `monaco.editor.defineTheme` 的主题数据。
 */
function withMgtreeRules(themeName, monacoTheme) {
  return {
    ...monacoTheme,
    inherit: true,
    rules: [...(monacoTheme.rules || []), ...treeTokenRules(isDarkTheme(themeName))],
  };
}

/**
 * 初始化 Monaco 的语言与主题注册。
 *
 * 整个流程只执行一次；失败时退化为 Monaco 内置主题并显式上报，而不是静默留下一个
 * 没有颜色的编辑器。
 *
 * @returns {Promise<void>} 注册完成（或失败并已上报）后解析。
 */
export function initMonacoShiki() {
  disableBundledLanguageServices(monaco);
  if (runtime.ready) return Promise.resolve();
  if (runtime.promise) return runtime.promise;

  runtime.promise = (async () => {
    try {
      registerMgtreeLanguage(monaco);

      const [{ createHighlighter }, { shikiToMonaco, textmateThemeToMonacoTheme }] =
        await Promise.all([import('shiki'), import('@shikijs/monaco')]);

      const highlighter = await createHighlighter({
        themes: [DARK_THEME_NAME, LIGHT_THEME_NAME],
        langs: SHIKI_LANGS,
      });

      // Patch a private, writable API first. A partial bootstrap failure must not
      // leave Monaco's public create/setTheme methods calling an unloaded theme.
      const shikiEditor = { ...monaco.editor, create: runtime.create, setTheme: runtime.setTheme };
      const shikiHost = { editor: shikiEditor, languages: monaco.languages };
      shikiToMonaco(highlighter, shikiHost);

      // 给已加载的主题合并 mgtree 规则，再提交安全的公共方法。
      for (const themeName of [LIGHT_THEME_NAME, DARK_THEME_NAME]) {
        monaco.editor.defineTheme(
          themeName,
          withMgtreeRules(themeName, textmateThemeToMonacoTheme(highlighter.getTheme(themeName))),
        );
      }

      const normalizeTheme = (name) => highlighter.getLoadedThemes().includes(name) ? name
        : normalizeThemeName(name);
      monaco.editor.setTheme = (name) => shikiEditor.setTheme(normalizeTheme(name));
      monaco.editor.create = (element, options, overrides) => shikiEditor.create(element,
        { ...options, theme: normalizeTheme(options?.theme) }, overrides);
      monaco.editor.setTheme(readPreferredThemeName());
      runtime.ready = true;
    } catch (error) {
      monaco.editor.create = fallbackCreate;
      monaco.editor.setTheme = fallbackSetTheme;
      console.error(
        '[mde/highlight] Shiki bootstrap failed, falling back to Monaco built-in themes:',
        error,
      );
    }
  })().finally(() => { if (!runtime.ready) runtime.promise = null; });

  return runtime.promise;
}

/**
 * 判断 Monaco 的语言与主题是否已经注册完成。
 *
 * @returns {boolean} 注册完成时为 true。
 */
export function isMonacoShikiReady() {
  return runtime.ready;
}

/**
 * 根据主题模式返回应使用的 Monaco 主题名。
 *
 * @param {boolean} isDark 是否处于深色模式。
 * @returns {string} 已注册的主题名；Shiki 未就绪时使用同名的 Monaco 基础主题。
 */
export function getMonacoThemeName(isDark) {
  return isDark ? DARK_THEME_NAME : LIGHT_THEME_NAME;
}
