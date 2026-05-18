import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enUS from './locales/en_us.json';
import zhCN from './locales/zh_cn.json';

function readInitialLang() {
  try {
    const persisted = localStorage.getItem('i18nextLng')
      || JSON.parse(localStorage.getItem('mde-config') || 'null')?.state?.language;
    if (persisted) {
      return /^zh/i.test(persisted) ? 'zh' : 'en';
    }
  } catch { /* ignore */ }
  if (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')) {
    return 'zh';
  }
  return 'en';
}

const initialLang = readInitialLang();
document.documentElement.lang = initialLang;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Keep app chrome translations synchronous. These JSON files are small
    // (~9 KB each) and correctness matters more than saving a few milliseconds:
    // async hydration renders raw keys until another UI update happens.
    resources: {
      en: { translation: enUS },
      zh: { translation: zhCN },
    },
    lng: initialLang,
    fallbackLng: 'en',
    initImmediate: true,
    interpolation: { escapeValue: false },
    // Our locale JSONs use flat keys with dots in them (e.g.
    // "toolbar.bold"). Default i18next splits on `.` and walks nested
    // objects; the `ignoreJSONStructure: true` fallback works in Vite dev
    // (where JSON modules expose every top-level key as a named export)
    // but not in production builds (where the chunk only exports `default`).
    // Disabling the separator forces literal-key lookup, which works in
    // both modes.
    keySeparator: false,
    nsSeparator: false,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

i18n.on('languageChanged', (lng) => {
  const key = /^zh/i.test(lng) ? 'zh' : 'en';
  document.documentElement.lang = key;
});

export default i18n;
