/**
 * Monaco NLS ???????
 *
 * ?? ESM ???? `monaco-editor-nls-adapter/proxy` ???????? Vite ? Monaco ???????????
 */
// 基于 ESM 重新实现的 `monaco-editor-nls-adapter/proxy`。
//
// 原包使用 CommonJS `module.exports = { ... }` 导出。Vite 预构建后，
// esbuild 会把它整理成 `export default require_proxy()`，也就是只留下
// 默认导出。
//
// 但 Monaco 转译后的代码采用的是
// `import * as nls from 'monaco-editor-nls-adapter/proxy'`，
// 随后直接调用 `nls.localize(path, key, defaultMessage)`。
// 如果模块只有默认导出，那么 `nls.localize` 就会是 `undefined`，
// 所有本地化调用要么直接抛错，要么悄悄退回默认行为。
//
// 这个文件提供了一个纯 ESM 的等价替身，并通过 `vite.config.js` 做 alias，
// 让 Monaco 访问到真实的命名导出，如 `nls.localize`、`nls.localize2` 等。

const globalObj =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : // eslint-disable-next-line no-undef
        global;

globalObj.__MONACO_NLS_ADAPTER_STATE__ =
  globalObj.__MONACO_NLS_ADAPTER_STATE__ || { data: null, name: '' };

/**
 * ???? Monaco NLS ?????
 */
const getState = () => globalObj.__MONACO_NLS_ADAPTER_STATE__;
/**
 * ??????????????????????
 */
const getDebugState = () => {
  globalObj.__MONACO_NLS_DEBUG__ = globalObj.__MONACO_NLS_DEBUG__ || {
    loggedFindWidget: false,
    loggedUntransformedCall: false,
  };
  return globalObj.__MONACO_NLS_DEBUG__;
};

const FORMAT_REGEX = /\{(\d+)\}/g;

/**
 * ? Monaco ???????????????????
 */
function _format(message, args) {
  if (!args || args.length === 0) return message;
  return String(message).replace(FORMAT_REGEX, (match, index) => {
    const r = args[parseInt(index, 10)];
    return typeof r !== 'undefined' ? r : match;
  });
}

/**
 * ??????????????????????????
 */
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

/**
 * ???? Monaco `localize2` ?????????
 */
export function localize2(path, data, defaultMessage, ...args) {
  const v = localize(path, data, defaultMessage, ...args);
  return { value: v, original: v };
}

/**
 * ???????????????????
 */
export function setLocaleData(data, locale = 'custom') {
  const s = getState();
  s.data = data;
  s.name = locale;

  if (import.meta.env?.DEV) {
    // 仅在开发环境打印一次启动日志，用于确认 Monaco 渲染前语言已正确装载。
    // 生产构建中这里不会产生实际影响。
    // eslint-disable-next-line no-console
    console.log('[mde/nls] setLocaleData →', locale, data ? '(loaded)' : '(cleared)');
  }
}

/**
 * ??????????????
 */
export function getLocaleData() {
  return getState().data;
}

/**
 * ???????????
 */
export function getLocaleName() {
  return getState().name;
}

/**
 * ?????????????????????
 */
export function getConfiguredDefaultLocale() {
  return undefined;
}

// Monaco 的 worker 启动代码也会从 `vs/nls.js` 读取这些导出。
// 这里没有采用 VS Code 的“按索引存储消息数组”方案，因此消息保持 undefined，
// 运行时会在适用处自然回退到默认英文文案。
/**
 * ??? Monaco worker ????????
 */
export function getNLSLanguage() {
  return getState().name || undefined;
}

/**
 * ??? worker ??????????????????????
 */
export function getNLSMessages() {
  return undefined;
}

/**
 * ?? Monaco ??????????
 */
export function loadMessageBundle() {
  return localize;
}

/**
 * ???????????????
 */
export function config() {
  return loadMessageBundle;
}

/**
 * ??????????????????
 */
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
