import { describe, expect, it } from 'vitest';
import { normalizeLanguage, readInitialLanguage } from './language';

function createStorage(values = {}) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

describe('startup language resolution', () => {
  it('normalizes the supported Chinese and English locale families', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
  });

  it('uses the app config as the single authoritative persisted value', () => {
    const storage = createStorage({
      'mde-config': JSON.stringify({ state: { language: 'en' } }),
      i18nextLng: 'zh-CN',
    });

    expect(readInitialLanguage({ storage, navigatorLanguage: 'zh-CN' })).toBe('en');
  });

  it('supports the legacy i18next cache when app config has no language', () => {
    const storage = createStorage({ i18nextLng: 'zh-CN' });

    expect(readInitialLanguage({ storage, navigatorLanguage: 'en-US' })).toBe('zh');
  });

  it('falls back to the platform language for a new profile', () => {
    expect(readInitialLanguage({ storage: createStorage(), navigatorLanguage: 'zh-CN' }))
      .toBe('zh');
  });

  it('continues to legacy fallbacks when mde-config is malformed', () => {
    const storage = createStorage({
      'mde-config': '{broken',
      i18nextLng: 'zh-CN',
    });

    expect(readInitialLanguage({ storage, navigatorLanguage: 'en-US' })).toBe('zh');
  });
});
