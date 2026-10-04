import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import i18n from '@/i18n';
import useEditorStore from '@store/useEditorStore';
import useScriptStore, { isScriptRunning } from '@store/useScriptStore';
import { isImeComposing } from '@utils/keyboard';
import useCodeBlockRunStore, { isBlockRunning } from '@store/useCodeBlockRunStore';

const BLOCK_LANGUAGES = {
  js: 'javascript', javascript: 'javascript',
  py: 'python', python: 'python',
  cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin', kotlin: 'kotlin',
  rs: 'rust', rust: 'rust',
};
export function getCodeBlockLanguage(info = '') {
  const key = String(info).trim().split(/\s+/)[0].toLowerCase();
  return Object.hasOwn(BLOCK_LANGUAGES, key) ? BLOCK_LANGUAGES[key] : null;
}

const LANGUAGES = { cs: 'csharp', js: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin', rs: 'rust' };
export function getScriptLanguage(name = '') {
  const key = name.split('.').pop()?.toLowerCase();
  return Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key] : null;
}

let subscription;
const blockRuns = new Map();
const pendingInputs = new Map();
function receiveOutput(payload) {
  const key = blockRuns.get(payload.runId);
  if (key) {
    useCodeBlockRunStore.getState().receive(key, payload);
    if (payload.kind === 'exit') blockRuns.delete(payload.runId);
  } else useScriptStore.getState().receive(payload);
}
async function writeInput(runId, text, receive, isCurrent) {
  if (pendingInputs.has(runId)) return false;
  const events = [];
  pendingInputs.set(runId, events);
  try {
    // 程序可能在 IPC 返回前就输出下一轮提示；先暂存它，成功后按输入、响应顺序回显。
    await invoke('write_script_input', { runId, text });
    receive({ runId, kind: 'stdin', text: `${text}\n` });
    return isCurrent();
  } catch (error) {
    receive({ runId, kind: 'stderr', text: `${error?.message || error}\n` });
    return false;
  } finally {
    pendingInputs.delete(runId);
    events.forEach(receiveOutput);
  }
}
async function ensureEvents() {
  if (!subscription) {
    subscription = listen('script-output', ({ payload }) => {
      const pending = pendingInputs.get(payload.runId);
      if (pending) pending.push(payload);
      else receiveOutput(payload);
    })
      .catch((error) => { subscription = null; throw error; });
  }
  return subscription;
}

export const scriptRunner = {
  async runBlock({ key, language, source, filePath, fileName }) {
    const store = useCodeBlockRunStore.getState();
    if (isBlockRunning(store.blocks[key]?.status)) return;
    const runId = crypto.randomUUID();
    store.prepare(key, { runId, language, source, fileName });
    blockRuns.set(runId, key);
    try {
      if (!['javascript', 'python', 'csharp', 'java', 'kotlin', 'rust'].includes(language)) throw new Error(i18n.t('console.unsupportedBlock'));
      if (!window.__TAURI_INTERNALS__) throw new Error(i18n.t('codeBlock.desktopOnly'));
      await ensureEvents();
      await invoke('start_script', { request: { runId, language, source, filePath: filePath || null,
        runtimePath: useScriptStore.getState().runtimePaths[language] || null, cacheKey: key } });
      if (useCodeBlockRunStore.getState().blocks[key]?.status === 'stopping') await invoke('stop_script', { runId });
    } catch (error) {
      store.receive(key, { runId, kind: 'stderr', text: `${error?.message || error}\n` });
      store.receive(key, { runId, kind: 'exit', exitCode: null });
      blockRuns.delete(runId);
    }
  },
  async stopBlock(key) {
    const store = useCodeBlockRunStore.getState();
    const current = store.blocks[key];
    if (!current || !isBlockRunning(current.status)) return;
    const { runId, status } = current;
    store.setStatus(key, runId, 'stopping');
    try { await invoke('stop_script', { runId }); }
    catch (error) {
      store.receive(key, { runId, kind: 'stderr', text: `${error?.message || error}\n` });
      if (isBlockRunning(useCodeBlockRunStore.getState().blocks[key]?.status)) store.setStatus(key, runId, status);
    }
  },
  async sendBlockInput(key, text) {
    const store = useCodeBlockRunStore.getState();
    const current = store.blocks[key];
    if (current?.status !== 'running') return false;
    return writeInput(current.runId, text, (event) => store.receive(key, event),
      () => useCodeBlockRunStore.getState().blocks[key]?.runId === current.runId);
  },
  async runCurrent() {
    const state = useScriptStore.getState();
    if (isScriptRunning(state.status)) { state.setToolTab('output'); return; }
    const tab = useEditorStore.getState().getActiveTab();
    const language = getScriptLanguage(tab?.name);
    const runId = crypto.randomUUID();
    state.prepare({ runId, fileName: tab?.name || '', language });
    try {
      if (!language) throw new Error(i18n.t('console.unsupportedFile'));
      if (!window.__TAURI_INTERNALS__) throw new Error(i18n.t('console.desktopOnly'));
      await ensureEvents();
      await invoke('start_script', { request: {
        runId, language, source: tab.content || '', filePath: tab.path || null,
        runtimePath: state.runtimePaths[language] || null,
      } });
      // A stop pressed while the listener was starting must reach the new process.
      if (useScriptStore.getState().status === 'stopping') await invoke('stop_script', { runId });
    } catch (error) {
      useScriptStore.getState().receive({ runId, kind: 'stderr', text: `${error?.message || error}\n` });
      useScriptStore.getState().receive({ runId, kind: 'exit', exitCode: null });
    }
  },
  async stop() {
    const { runId, status } = useScriptStore.getState();
    if (!runId || !isScriptRunning(status)) return;
    useScriptStore.setState({ status: 'stopping' });
    try { await invoke('stop_script', { runId }); }
    catch (error) {
      useScriptStore.getState().receive({ runId, kind: 'stderr', text: `${error?.message || error}\n` });
      const current = useScriptStore.getState();
      if (current.runId === runId && isScriptRunning(current.status)) useScriptStore.setState({ status });
    }
  },
  async sendInput(text) {
    const { runId, status } = useScriptStore.getState();
    if (!runId || status !== 'running') return false;
    return writeInput(runId, text, (event) => useScriptStore.getState().receive(event),
      () => useScriptStore.getState().runId === runId);
  },
};

export function handleScriptShortcut(event) {
  if (event.key !== 'F5' || isImeComposing(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) {
    if (event.shiftKey) scriptRunner.stop();
    else scriptRunner.runCurrent();
  }
  return true;
}

if (import.meta.hot) import.meta.hot.dispose(() => { subscription?.then((stop) => stop()); });
