/**
 * Monaco ????????
 *
 * ??? Monaco ?????????????????????????????????
 */
import zhHans from 'monaco-editor-nls-adapter/locales/zh-hans.json';

const globalObj =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : // eslint-disable-next-line no-undef
        global;

/**
 * ??????? Monaco NLS ?????????
 */
function setAdapterLocaleData(data, locale = 'custom') {
  globalObj.__MONACO_NLS_ADAPTER_STATE__ =
    globalObj.__MONACO_NLS_ADAPTER_STATE__ || { data: null, name: '' };
  globalObj.__MONACO_NLS_ADAPTER_STATE__.data = data;
  globalObj.__MONACO_NLS_ADAPTER_STATE__.name = locale;
}

/**
 * 从 Zustand 持久化到 localStorage 的 `mde-config` 中读取语言配置。
 * 这里必须同步执行，确保 Monaco 在渲染任何内置界面之前就拿到目标语言。
 */
function readPersistedLang() {
  try {
    const raw = localStorage.getItem('mde-config');
    if (raw) {
      return JSON.parse(raw)?.state?.language || 'en';
    }
  } catch {
    // 读取失败时忽略，继续回退到默认语言。
  }
  return 'en';
}

/**
 * ????????????????????????
 */
function readRuntimeLang() {
  const runtimeLang =
    globalObj.i18next?.language
    || globalObj.i18n?.language
    || document.documentElement.lang;
  return /^zh/i.test(runtimeLang || '') ? 'zh' : null;
}

/**
 * 切换 Monaco Editor 内置界面的语言。
 * 传入 `zh` 时加载简体中文词典，其他值则回退为英文。
 *
 * 查找框、命令面板、右键菜单这类运行时才创建的控件，会在下次打开时读取新语言，
 * 因为代理层会在渲染阶段拦截 `localize()` 调用。
 *
 * 但 Monaco 首次加载时就在模块顶层缓存下来的文案，只会使用当时的语言状态，
 * 所以这个初始化必须发生在第一次 `import 'monaco-editor'` 之前。
 * 相关启动顺序见 `monacoLocaleBoot.js`。
 */
export function setMonacoLocale(lang) {
  if (lang === 'zh') {
    setAdapterLocaleData(zhHans, 'zh-hans');
  } else {
    // 传入 null 后，各处 `localize()` 会回退到默认文案，也就是英文。
    setAdapterLocaleData(null, 'en');
  }
}

/**
 * 只需在 `monaco.editor.create()` 之前调用一次。
 * 它会读取用户当前保存或运行时生效的语言偏好，并据此设置 Monaco 的界面语言。
 */
export function initMonacoLocale() {
  const lang = readRuntimeLang() || readPersistedLang();
  setMonacoLocale(lang);
}
