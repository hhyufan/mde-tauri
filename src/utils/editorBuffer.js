/**
 * 编辑器的内存缓冲区。
 *
 * 它刻意放在 React 状态之外，这样用户在 Monaco 中输入时就不会触发
 * Zustand 更新，也不会连带让编辑区、预览区、大纲、状态栏、标签栏等一起重渲染。
 * 需要消费内容变化的 React 侧模块，通过 `subscribe(fn)` 自行决定节流或防抖策略。
 *
 * 这和 VS Code、Obsidian 以及原版 miaogu-notepad 的思路一致：
 * 在活跃编辑阶段，编辑器自身维护“当前真值”，应用其他部分只在需要渲染
 * 或持久化时再读取这份内容。
 */

const buffers = new Map();
const listeners = new Set();

let pendingIds = new Set();
let scheduled = false;

/**
 * ???????????????????
 */
function flush() {
  scheduled = false;
  const ids = pendingIds;
  pendingIds = new Set();
  listeners.forEach((fn) => {
    try {
      fn(ids);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[editorBuffer] listener threw', err);
    }
  });
}

/**
 * ?????????????????????????
 */
function schedule() {
  if (scheduled) return;
  scheduled = true;
  // 用 `setTimeout(0)` 把通知推迟到当前按键处理结束之后，避免 React 工作打断输入手感。
  setTimeout(flush, 0);
}

/**
 * ??????????????????????
 */
export function setBuffer(tabId, content) {
  if (!tabId) return;
  const cur = buffers.get(tabId);
  if (cur === content) return;
  buffers.set(tabId, content);
  pendingIds.add(tabId);
  schedule();
}

/**
 * ?????????????????????
 */
export function getBuffer(tabId, fallback = '') {
  return buffers.has(tabId) ? buffers.get(tabId) : fallback;
}

/**
 * ????????????????
 */
export function hasBuffer(tabId) {
  return buffers.has(tabId);
}

export function clearBuffer(tabId) {
  if (!tabId) return;
  if (buffers.delete(tabId)) {
    pendingIds.add(tabId);
    schedule();
  }
}

/**
 * ?????????????????
 */
export function renameBuffer(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  if (!buffers.has(oldId)) return;
  buffers.set(newId, buffers.get(oldId));
  buffers.delete(oldId);
  pendingIds.add(oldId);
  pendingIds.add(newId);
  schedule();
}

/**
 * ????????????????????
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
