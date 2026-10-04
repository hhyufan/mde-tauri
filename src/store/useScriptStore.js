import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const OUTPUT_LIMIT = 256 * 1024;
const useScriptStore = create(persist((set, get) => ({
  open: false,
  toolTab: 'output',
  height: 240,
  runtimePaths: { javascript: '', python: '', csharp: '', java: '', kotlin: '', rust: '' },
  runId: null,
  fileName: '',
  language: '',
  status: 'idle',
  logs: [],
  truncated: false,
  exitCode: null,
  elapsedMs: 0,
  setOpen: (open) => set((state) => state.open === open ? state : { open }),
  setToolTab: (toolTab) => set((state) => state.toolTab === toolTab && state.open
    ? state : { toolTab, open: true }),
  setHeight: (height) => {
    if (!Number.isFinite(height)) return;
    const next = Math.max(140, Math.min(600, height));
    set((state) => state.height === next ? state : { height: next });
  },
  setRuntimePath: (language, path) => set((state) => ({
    runtimePaths: { ...state.runtimePaths, [language]: path },
  })),
  clear: () => set({ logs: [], truncated: false }),
  prepare: ({ runId, fileName, language }) => set({
    runId, fileName, language, open: true, toolTab: 'output', status: 'preparing',
    logs: [], truncated: false, exitCode: null, elapsedMs: 0,
  }),
  append: (kind, text) => {
    if (!text) return;
    set((state) => {
      const logs = [...state.logs, { kind, text }];
      let size = logs.reduce((sum, entry) => sum + entry.text.length, 0);
      let truncated = state.truncated;
      while (logs.length > 1 && (size > OUTPUT_LIMIT || logs.length > 2000)) {
        size -= logs.shift().text.length;
        truncated = true;
      }
      if (size > OUTPUT_LIMIT) {
        logs[0] = { ...logs[0], text: logs[0].text.slice(-OUTPUT_LIMIT) };
        truncated = true;
      }
      return { logs, truncated };
    });
  },
  receive: (event) => {
    if (event.runId !== get().runId) return;
    if (event.kind === 'exit') {
      set({
        status: event.cancelled ? 'stopped' : event.exitCode === 0 ? 'success' : 'error',
        exitCode: event.exitCode, elapsedMs: event.elapsedMs || 0,
      });
    } else if (event.kind === 'status' && event.text === 'started') {
      if (get().status !== 'stopping') set({ status: 'running' });
    } else get().append(event.kind, event.text);
  },
}), {
  name: 'mde-script-console',
  // Interpreter paths belong to this device, not cloud-synced settings.
  partialize: (state) => ({ height: state.height, runtimePaths: state.runtimePaths }),
}));

export const isScriptRunning = (status) => ['preparing', 'running', 'stopping'].includes(status);
export default useScriptStore;
