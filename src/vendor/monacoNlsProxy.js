// ESM-native reimplementation of monaco-editor-nls-adapter/proxy.
//
// The original package exports with CommonJS `module.exports = { ... }`. When Vite
// pre-bundles it, esbuild emits `export default require_proxy()` — i.e. only a
// default export. Monaco's transformed files, however, use
// `import * as nls from 'monaco-editor-nls-adapter/proxy'` and then call
// `nls.localize(path, key, defaultMessage)`. With only a default export,
// `nls.localize` is undefined and every call throws / silently falls through.
//
// This file is a pure-ESM drop-in with proper named exports, aliased in via
// `vite.config.js` so monaco sees real functions at `nls.localize`, `nls.localize2`, etc.

const globalObj =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : // eslint-disable-next-line no-undef
        global;

globalObj.__MONACO_NLS_ADAPTER_STATE__ =
  globalObj.__MONACO_NLS_ADAPTER_STATE__ || { data: null, name: '' };

const getState = () => globalObj.__MONACO_NLS_ADAPTER_STATE__;
const getDebugState = () => {
  globalObj.__MONACO_NLS_DEBUG__ = globalObj.__MONACO_NLS_DEBUG__ || {
    loggedFindWidget: false,
    loggedUntransformedCall: false,
  };
  return globalObj.__MONACO_NLS_DEBUG__;
};

const FORMAT_REGEX = /\{(\d+)\}/g;

function _format(message, args) {
  if (!args || args.length === 0) return message;
  return String(message).replace(FORMAT_REGEX, (match, index) => {
    const r = args[parseInt(index, 10)];
    return typeof r !== 'undefined' ? r : match;
  });
}

export function localize(path, data, defaultMessage, ...args) {
  const key = data && typeof data === 'object' ? data.key : data;
  const state = getState();
  const fileData = state.data && state.data[path];
  const message = fileData ? fileData[key] : undefined;
  if (import.meta.env?.DEV) {
    const debug = getDebugState();
    if (!debug.loggedFindWidget && path === 'vs/editor/contrib/find/browser/findWidget') {
      debug.loggedFindWidget = true;
      // eslint-disable-next-line no-console
      console.log('[mde/nls/localize findWidget]', {
        locale: state.name,
        key,
        hasFileData: !!fileData,
        translated: message,
        fallback: defaultMessage,
      });
    }
    if (!debug.loggedUntransformedCall && typeof path === 'string' && path.startsWith('label.')) {
      debug.loggedUntransformedCall = true;
      // eslint-disable-next-line no-console
      console.warn('[mde/nls] detected untransformed Monaco call', {
        path,
        key,
        defaultMessage,
      });
    }
  }
  const final =
    message !== undefined && message !== null && message !== ''
      ? message
      : defaultMessage;
  return args.length > 0 ? _format(final, args) : final;
}

export function localize2(path, data, defaultMessage, ...args) {
  const v = localize(path, data, defaultMessage, ...args);
  return { value: v, original: v };
}

export function setLocaleData(data, locale = 'custom') {
  const s = getState();
  s.data = data;
  s.name = locale;

  if (import.meta.env?.DEV) {
    // One-shot boot log so we can verify locale is loaded before Monaco renders.
    // Silently no-ops in production builds.
    // eslint-disable-next-line no-console
    console.log('[mde/nls] setLocaleData →', locale, data ? '(loaded)' : '(cleared)');
  }
}

export function getLocaleData() {
  return getState().data;
}

export function getLocaleName() {
  return getState().name;
}

export function getConfiguredDefaultLocale() {
  return undefined;
}

// Monaco also imports these from `vs/nls.js` in worker bootstrap code.
// We don't use VS Code's indexed message arrays, so messages stay undefined
// and the runtime falls back to default English strings where applicable.
export function getNLSLanguage() {
  return getState().name || undefined;
}

export function getNLSMessages() {
  return undefined;
}

export function loadMessageBundle() {
  return localize;
}

export function config() {
  return loadMessageBundle;
}

export function create(key) {
  return {
    localize: (idx, def, ...args) => localize(key, idx, def, ...args),
    localize2: (idx, def, ...args) => localize2(key, idx, def, ...args),
    getConfiguredDefaultLocale: () => undefined,
  };
}

const proxy = {
  localize,
  localize2,
  setLocaleData,
  getLocaleData,
  getLocaleName,
  getConfiguredDefaultLocale,
  getNLSLanguage,
  getNLSMessages,
  loadMessageBundle,
  config,
  create,
};

export default proxy;
