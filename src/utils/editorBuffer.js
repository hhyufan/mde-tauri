/**
 * In-memory editor buffer.
 *
 * Lives outside React state so that typing in Monaco never triggers a
 * Zustand update (and therefore never re-renders the editor, preview,
 * outline, status bar, or tab bar). React subscribers consume buffer
 * changes through `subscribe(fn)` with their own debounce policy.
 *
 * This mirrors the approach used by editors such as VS Code, Obsidian,
 * and the original miaogu-notepad: the editor owns the source of truth
 * during active editing, and the rest of the app only reads when it
 * needs to render or persist.
 */

const buffers = new Map();
const listeners = new Set();

let pendingIds = new Set();
let scheduled = false;

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

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // setTimeout(0) lets the current keystroke finish before React work runs.
  setTimeout(flush, 0);
}

export function setBuffer(tabId, content) {
  if (!tabId) return;
  const cur = buffers.get(tabId);
  if (cur === content) return;
  buffers.set(tabId, content);
  pendingIds.add(tabId);
  schedule();
}

export function getBuffer(tabId, fallback = '') {
  return buffers.has(tabId) ? buffers.get(tabId) : fallback;
}

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

export function renameBuffer(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  if (!buffers.has(oldId)) return;
  buffers.set(newId, buffers.get(oldId));
  buffers.delete(oldId);
  pendingIds.add(oldId);
  pendingIds.add(newId);
  schedule();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
