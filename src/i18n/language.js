/**
 * Normalize the application's supported language set.
 *
 * @param {unknown} value Raw locale value.
 * @param {'zh' | 'en'} [fallback='en'] Language used when no value is present.
 * @returns {'zh' | 'en'}
 */
export function normalizeLanguage(value, fallback = 'en') {
  if (value == null || value === '') return fallback;
  return /^zh/i.test(String(value)) ? 'zh' : 'en';
}

/**
 * Resolve one startup language for React, the config store and Monaco.
 * The app setting is authoritative; i18next's cache is only a compatibility
 * fallback for profiles created before language lived in mde-config.
 *
 * @param {object} [options]
 * @param {Storage | null} [options.storage]
 * @param {string} [options.navigatorLanguage]
 * @returns {'zh' | 'en'}
 */
export function readInitialLanguage(options = {}) {
  const storage = options.storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : options.storage;
  const navigatorLanguage = options.navigatorLanguage === undefined
    ? (typeof navigator !== 'undefined' ? navigator.language : '')
    : options.navigatorLanguage;

  if (storage) {
    try {
      const configLanguage = JSON.parse(storage.getItem('mde-config') || 'null')
        ?.state?.language;
      if (configLanguage) return normalizeLanguage(configLanguage);
    } catch {
      // A damaged app config must not prevent the compatibility fallbacks.
    }

    try {
      const cachedLanguage = storage.getItem('i18nextLng');
      if (cachedLanguage) return normalizeLanguage(cachedLanguage);
    } catch {
      // Ignore unavailable storage and fall back to the platform locale.
    }
  }

  return normalizeLanguage(navigatorLanguage);
}
