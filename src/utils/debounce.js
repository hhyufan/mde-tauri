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
