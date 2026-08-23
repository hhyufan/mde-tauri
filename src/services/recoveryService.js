import useEditorStore from '@store/useEditorStore';
import { getBuffer, subscribe as subscribeBuffer } from '@utils/editorBuffer';
import {
  clearRecoverySnapshot as clearNativeRecoverySnapshot,
  readFileContent,
  readRecoverySnapshot as readNativeRecoverySnapshot,
  writeRecoverySnapshot as writeNativeRecoverySnapshot,
} from '@utils/tauriApi';

const RECOVERY_SCHEMA_VERSION = 1;
const RECOVERY_DEBOUNCE_MS = 1000;
let timer = null;
let unsubscribeBuffer = null;
let unsubscribeStore = null;
let writeChain = Promise.resolve();

function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

async function hashText(content) {
  const bytes = new TextEncoder().encode(content || '');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function buildSnapshot() {
  const state = useEditorStore.getState();
  const metaById = new Map(state.tabRenderList.map((tab) => [tab.id, tab]));
  const dirtyTabs = state.tabs.filter((tab) => metaById.get(tab.id)?.modified ?? tab.modified);
  const tabs = await Promise.all(dirtyTabs.map(async (tab) => {
    const content = getBuffer(tab.id, tab.content || '');
    const lastSavedContent = tab.content || '';
    return {
      recoveryId: tab.recoveryId || tab.id,
      tabId: tab.id,
      name: tab.name || 'Untitled.md',
      path: tab.path || '',
      encoding: tab.encoding || 'UTF-8',
      lineEnding: tab.lineEnding || 'LF',
      lastSavedHash: await hashText(lastSavedContent),
      recoveryHash: await hashText(content),
      modified: true,
      content,
    };
  }));
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    updatedAt: Date.now(),
    activeTabId: state.activeTabId,
    tabs,
  };
}

export async function flushRecoverySnapshot() {
  if (!isTauriRuntime()) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const snapshot = await buildSnapshot();
  writeChain = writeChain.then(() => (
    snapshot.tabs.length > 0
      ? writeNativeRecoverySnapshot(snapshot)
      : clearNativeRecoverySnapshot()
  ));
  return writeChain;
}

function scheduleRecoverySnapshot() {
  if (!isTauriRuntime()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    flushRecoverySnapshot().catch((error) => {
      console.warn('[recovery] Failed to persist draft snapshot:', error);
    });
  }, RECOVERY_DEBOUNCE_MS);
}

export function startRecoveryTracking() {
  if (!isTauriRuntime() || unsubscribeBuffer || unsubscribeStore) return () => {};
  unsubscribeBuffer = subscribeBuffer(scheduleRecoverySnapshot);
  unsubscribeStore = useEditorStore.subscribe((state, previous) => {
    if (state.tabs !== previous.tabs || state.tabRenderList !== previous.tabRenderList) {
      scheduleRecoverySnapshot();
    }
  });
  const handleBlur = () => flushRecoverySnapshot().catch(() => {});
  window.addEventListener('blur', handleBlur);
  return () => {
    unsubscribeBuffer?.();
    unsubscribeStore?.();
    unsubscribeBuffer = null;
    unsubscribeStore = null;
    window.removeEventListener('blur', handleBlur);
  };
}

export async function loadRecoveryCandidates() {
  if (!isTauriRuntime()) return [];
  const snapshot = await readNativeRecoverySnapshot();
  if (!snapshot?.tabs?.length) return [];
  const candidates = [];
  for (const draft of snapshot.tabs) {
    if (!draft.path) {
      candidates.push(draft);
      continue;
    }
    try {
      const disk = await readFileContent(draft.path);
      if (!disk?.success) {
        candidates.push({ ...draft, diskState: 'missing' });
        continue;
      }
      const diskHash = await hashText(disk.content || '');
      if (diskHash !== draft.recoveryHash) {
        candidates.push({ ...draft, diskState: diskHash === draft.lastSavedHash ? 'unchanged' : 'changed' });
      }
    } catch {
      candidates.push({ ...draft, diskState: 'missing' });
    }
  }
  return candidates;
}

export async function discardRecoverySnapshot() {
  if (isTauriRuntime()) await clearNativeRecoverySnapshot();
}
