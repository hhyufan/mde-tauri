/**
 * 生成基础防抖函数。
 *
 * 连续触发期间只保留最后一次执行，并暴露 `cancel()` 供调用方主动清理。
 */
/**
 * ?????????????????????????
 */
export function debounce(fn, delay) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/** Independent timers prevent edits in one document from canceling another. */
export function debounceByKey(fn, delay) {
  const timers = new Map();
  const debounced = (key, ...args) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      fn(key, ...args);
    }, delay));
  };
  debounced.cancel = () => { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); };
  return debounced;
}
