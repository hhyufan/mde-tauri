/**
 * 应用国际化初始化入口。
 *
 * 本文件负责确定初始语言、注册中英文资源、初始化 i18next，并在语言切换时
 * 同步更新根节点的 `lang` 属性，供界面与可访问性能力复用。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enUS from './locales/en_us.json';
import zhCN from './locales/zh_cn.json';
import { readInitialLanguage } from './language';

/**
 * 读取应用启动时应采用的初始语言。
 *
 * 应用配置、旧版 i18next 缓存和系统语言必须通过同一个解析器决定，避免
 * React 界面与 Monaco 在全新 profile 或缓存不一致时选出不同语言。
 */
const initialLang = readInitialLanguage();
document.documentElement.lang = initialLang;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // 保持应用界面文案同步加载。这些 JSON 文件都很小
    // （每个约 9 KB），相比节省几毫秒，更重要的是保证正确性：
    // 异步注水期间会先渲染原始 key，直到下一次界面更新才恢复正常。
    resources: {
      en: { translation: enUS },
      zh: { translation: zhCN },
    },
    lng: initialLang,
    fallbackLng: 'en',
    initImmediate: true,
    interpolation: { escapeValue: false },
    // 语言包 JSON 使用的是带点号的扁平 key（例如
    // "toolbar.bold"）。i18next 默认会按 `.` 拆分并遍历嵌套对象；
    // `ignoreJSONStructure: true` 这个兜底方案在 Vite 开发环境可用
    // （此时 JSON 模块会把每个顶层 key 都暴露成命名导出），
    // 但在生产构建中不可用（构建产物通常只导出 `default`）。
    // 关闭分隔符后会强制按字面量 key 查询，从而同时兼容两种模式。
    keySeparator: false,
    nsSeparator: false,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

/**
 * 在语言切换后同步更新 `<html lang>`，便于浏览器与辅助技术感知当前语言。
 */
i18n.on('languageChanged', (lng) => {
  const key = /^zh/i.test(lng) ? 'zh' : 'en';
  document.documentElement.lang = key;
});

export default i18n;
