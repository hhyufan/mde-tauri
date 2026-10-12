/**
 * 品牌更名（MDE → MokiDown）后的一次性本地存储迁移。
 *
 * 旧版本用 `mde-` / `mde:` 前缀持久化本地状态（配置、主题、文件列表、设备标识、
 * 树展开状态、浮动工具栏位置等）；更名后统一改成 `mokidown-` / `mokidown:`。
 * 这里只在“新键不存在”时把旧键的值复制一份，并且从不删除旧键，
 * 既保证用户数据不丢失，也允许随时回滚到旧版本。
 *
 * 迁移必须在任何 zustand persist store 回填之前完成：persist 只在创建时读取一次
 * 存储，如果先回填了空的新键，首启就会出现“设备标识重置、设置丢失”的假象。
 * 因此本模块在被 import 时立即执行一次，并由 `src/main.jsx` 作为第一条 import 引入。
 */
const LEGACY_PREFIX = 'mde';
const CURRENT_PREFIX = 'mokidown';

/**
 * 把旧前缀的键复制到新前缀（新键缺失时才复制，旧键始终保留）。
 *
 * @param {Storage | null} [storage] 目标存储；默认使用 window.localStorage。
 * @returns {number} 实际复制的键数量。
 */
export function migrateLegacyBrandKeys(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage) return 0;
  let migrated = 0;
  try {
    const legacyKeys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      // 只认 `mde-` / `mde:` 这种前缀，避免误伤其它恰好包含 mde 的键。
      if (typeof key === 'string' && key.startsWith(LEGACY_PREFIX)
        && ['-', ':'].includes(key.charAt(LEGACY_PREFIX.length))) {
        legacyKeys.push(key);
      }
    }
    for (const key of legacyKeys) {
      const next = `${CURRENT_PREFIX}${key.slice(LEGACY_PREFIX.length)}`;
      if (storage.getItem(next) !== null) continue;
      const value = storage.getItem(key);
      if (value === null) continue;
      storage.setItem(next, value);
      migrated += 1;
    }
  } catch {
    // 存储不可用（隐私模式、配额不足等）时静默跳过：迁移失败不能影响应用启动。
  }
  return migrated;
}

// 模块求值时立即迁移，保证早于所有 persist store 的创建与回填。
migrateLegacyBrandKeys();
