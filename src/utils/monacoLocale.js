// Uses the ESM shim aliased via vite.config.js. The shim exposes named exports
// (unlike the upstream CJS proxy, which esbuild flattens to `export default`).
import { setLocaleData } from 'monaco-editor-nls-adapter/proxy';
import zhHans from 'monaco-editor-nls-adapter/locales/zh-hans.json';

/**
 * Read the persisted language from Zustand's localStorage entry (mde-config).
 * Called synchronously so the locale is set before Monaco renders any UI.
 */
function readPersistedLang() {
  try {
    const raw = localStorage.getItem('mde-config');
    if (raw) {
      return JSON.parse(raw)?.state?.language || 'en';
    }
  } catch {
    // ignore – fall through to default
  }
  return 'en';
}

/**
 * Switch Monaco Editor's built-in UI language.
 * Passing 'zh' loads the Simplified-Chinese locale; anything else resets to English.
 * Runtime-only widgets (Find, Command Palette, context menu, etc.) pick up the
 * change the next time they open because the proxy intercepts localize() calls
 * at render time. Module-scope strings captured during monaco's initial load
 * use whatever locale was active at that moment, which is why this must be
 * called before `monaco-editor` is first imported (see monacoLocaleBoot.js).
 */
export function setMonacoLocale(lang) {
  if (lang === 'zh') {
    setLocaleData(zhHans, 'zh-hans');
  } else {
    // Passing null causes every localize() call to fall back to its defaultMessage (English).
    setLocaleData(null, 'en');
  }
}

/**
 * Must be called once, before monaco.editor.create() runs.
 * Reads the user's saved language preference and sets Monaco's locale accordingly.
 */
export function initMonacoLocale() {
  const lang = readPersistedLang();
  setMonacoLocale(lang);
}
