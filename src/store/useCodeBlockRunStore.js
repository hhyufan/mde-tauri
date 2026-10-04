import { create } from 'zustand';

export const EMPTY_BLOCK_RUN = Object.freeze({ status: 'idle', logs: [], runId: null });
export const isBlockRunning = (status) => ['preparing', 'running', 'stopping'].includes(status);
const LIMIT = 128 * 1024;
export default create((set) => ({
  blocks: {},
  prepare: (key, run) => set((state) => {
    const blocks = { ...state.blocks };
    // Keep active runs, bound retained results from closed/large documents.
    const completed = Object.keys(blocks).filter((id) => !isBlockRunning(blocks[id].status));
    while (Object.keys(blocks).length >= 128 && completed.length) delete blocks[completed.shift()];
    blocks[key] = { ...run, status: 'preparing', logs: [], truncated: false, exitCode: null, elapsedMs: 0 };
    return { blocks };
  }),
  receive: (key, event) => set((state) => {
    const current = state.blocks[key];
    if (!current || current.runId !== event.runId) return state;
    let next;
    if (event.kind === 'exit') next = { ...current,
      status: event.cancelled ? 'stopped' : event.exitCode === 0 ? 'success' : 'error',
      exitCode: event.exitCode, elapsedMs: event.elapsedMs || 0 };
    else if (event.kind === 'status' && event.text === 'started') next = {
      ...current, status: current.status === 'stopping' ? 'stopping' : 'running' };
    else {
      const logs = [...current.logs, { kind: event.kind, text: event.text }];
      let size = logs.reduce((total, log) => total + log.text.length, 0);
      let truncated = current.truncated;
      while (logs.length > 1 && (size > LIMIT || logs.length > 1000)) {
        size -= logs.shift().text.length; truncated = true;
      }
      if (size > LIMIT) { logs[0] = { ...logs[0], text: logs[0].text.slice(-LIMIT) }; truncated = true; }
      next = { ...current, logs, truncated };
    }
    return { blocks: { ...state.blocks, [key]: next } };
  }),
  setStatus: (key, runId, status) => set((state) => {
    const current = state.blocks[key];
    return current?.runId === runId ? { blocks: { ...state.blocks, [key]: { ...current, status } } } : state;
  }),
  clear: (key) => set((state) => {
    const current = state.blocks[key];
    if (!current) return state;
    return { blocks: { ...state.blocks, [key]: { ...current, logs: [], truncated: false } } };
  }),
}));
