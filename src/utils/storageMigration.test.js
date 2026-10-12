import { describe, expect, it } from 'vitest';
import { migrateLegacyBrandKeys } from './storageMigration';

/**
 * 内存版 Storage 替身。
 *
 * 迁移函数接受任意 Storage，这里用它把测试与真实 localStorage 隔离开，
 * 顺便能构造"存储不可用"的场景。
 *
 * @param {Record<string, string>} [initial] 初始键值。
 * @returns {Storage & { dump: () => Record<string, string> }} 替身对象。
 */
function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map),
  };
}

describe('migrateLegacyBrandKeys', () => {
  it('把旧前缀的键拷到新前缀，并返回迁移条数', () => {
    const storage = createStorage({
      'mde-config': '{"theme":"dark"}',
      'mde:device-id': 'abc123',
    });

    expect(migrateLegacyBrandKeys(storage)).toBe(2);
    expect(storage.getItem('mokidown-config')).toBe('{"theme":"dark"}');
    expect(storage.getItem('mokidown:device-id')).toBe('abc123');
  });

  it('从不删除旧键，便于回滚到旧版本', () => {
    const storage = createStorage({ 'mde-config': 'legacy' });

    migrateLegacyBrandKeys(storage);

    expect(storage.getItem('mde-config')).toBe('legacy');
  });

  it('新键已存在时不覆盖，避免冲掉用户改名后的设置', () => {
    const storage = createStorage({
      'mde-config': 'legacy',
      'mokidown-config': 'current',
    });

    expect(migrateLegacyBrandKeys(storage)).toBe(0);
    expect(storage.getItem('mokidown-config')).toBe('current');
  });

  it('只认 mde- / mde: 前缀，不误伤恰好含 mde 的其它键', () => {
    const storage = createStorage({
      'theme-mode': 'dark',
      itemDefaults: 'keep',
      mdex: 'keep',
      mde: 'keep',
    });

    expect(migrateLegacyBrandKeys(storage)).toBe(0);
    expect(Object.keys(storage.dump()).sort()).toEqual(['itemDefaults', 'mde', 'mdex', 'theme-mode']);
  });

  it('存储不可用或抛错时静默跳过，不影响启动', () => {
    expect(migrateLegacyBrandKeys(null)).toBe(0);
    expect(
      migrateLegacyBrandKeys({
        get length() {
          throw new Error('blocked');
        },
      })
    ).toBe(0);
  });
});
