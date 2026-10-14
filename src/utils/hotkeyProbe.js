/**
 * 原生热键占用探测的缓存层。
 *
 * 探测要走一次 IPC 到 Rust 再回来，而设置界面里用户可能反复按键试组合，
 * 因此对同一键位的结果做短期缓存；同时把“同一键位的并发探测”合并成一次调用。
 *
 * 结果语义（`status`）：
 * - `available`：原生确认当前没有被别的程序占用。
 * - `taken`：原生确认已被占用（`RegisterHotKey` 返回 1409）。
 * - `invalid`：该组合本身无法注册为全局热键。
 * - `unsupported`：当前平台/环境无法探测（浏览器、macOS、Linux）。**这表示
 *   “不知道”，绝不能被当成“可用”。**
 */
import { checkHotkeyAvailable } from '@utils/tauriApi';

/** 缓存有效期：热键占用情况会随其他程序开关而变化，不宜缓存太久。 */
const CACHE_TTL_MS = 15_000;

/** @type {Map<string, {at: number, value: object}>} */
const cache = new Map();

/** @type {Map<string, Promise<object>>} 进行中的探测，用于合并并发请求。 */
const pending = new Map();

/**
 * 探测某个键位是否可用（带缓存与并发合并）。
 *
 * @param {string} keybinding 归一化键位；空串直接返回 `invalid` 而不发 IPC。
 * @param {() => Promise<object>} [probe] 探测实现，默认走原生命令（便于测试注入）。
 * @param {number} [now] 当前时间戳，便于测试控制缓存过期。
 * @returns {Promise<object>} 探测结果。
 */
export async function probeHotkeyAvailability(keybinding, probe = checkHotkeyAvailable, now = Date.now()) {
  if (typeof keybinding !== 'string' || keybinding === '') {
    return { status: 'invalid', reason: 'empty' };
  }

  const cached = cache.get(keybinding);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const inFlight = pending.get(keybinding);
  if (inFlight) return inFlight;

  const request = Promise.resolve()
    .then(() => probe(keybinding))
    .then((value) => {
      const result = value && typeof value === 'object' ? value : { status: 'unsupported' };
      // 缓存时间戳必须与判断时用同一个基准，否则读写两侧的时间来源不一致。
      cache.set(keybinding, { at: now, value: result });
      return result;
    })
    .catch((error) => {
      console.warn('[hotkeyProbe] probe failed:', error);
      return { status: 'unsupported' };
    })
    .finally(() => {
      pending.delete(keybinding);
    });

  pending.set(keybinding, request);
  return request;
}

/**
 * 清空缓存。
 *
 * 覆盖设置、导入配置之后必须调用：此时键位表被整体替换，旧结论不再可信。
 */
export function clearHotkeyProbeCache() {
  cache.clear();
  pending.clear();
}
