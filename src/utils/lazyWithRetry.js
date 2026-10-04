import { lazy } from 'react';

const RECOVERABLE_IMPORT_ERRORS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'outdated optimize dep',
  'load failed',
];

/**
 * 判断模块加载错误是否属于可通过短暂重试恢复的网络或 Vite 缓存错误。
 *
 * @param {unknown} error 动态导入抛出的错误。
 * @returns {boolean} 是否应该重试。
 */
export function isRecoverableImportError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return RECOVERABLE_IMPORT_ERRORS.some((fragment) => message.includes(fragment));
}

/**
 * 执行带有限次数退避重试的动态模块加载。
 *
 * @param {() => Promise<object>} importer 原始动态导入函数。
 * @param {{ retries?: number, delayMs?: number }} [options] 重试配置。
 * @returns {Promise<object>} 已加载模块。
 */
export async function importWithRetry(importer, { retries = 2, delayMs = 180 } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await importer();
    } catch (error) {
      if (!isRecoverableImportError(error) || attempt >= retries) throw error;
      attempt += 1;
      await new Promise((resolve) => window.setTimeout(resolve, delayMs * attempt));
    }
  }
}

/**
 * 创建能从开发服务器瞬时模块失效中恢复的 React 懒加载组件。
 *
 * @param {() => Promise<object>} importer 原始动态导入函数。
 * @param {{ retries?: number, delayMs?: number }} [options] 重试配置。
 * @returns {import('react').LazyExoticComponent<import('react').ComponentType<any>>} 懒加载组件。
 */
export function lazyWithRetry(importer, options) {
  return lazy(() => importWithRetry(importer, options));
}
