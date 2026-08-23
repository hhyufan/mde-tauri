import { create } from 'zustand';
import { flushRecoverySnapshot } from '@/services/recoveryService';

let pendingUpdate = null;

const useUpdaterStore = create((set, get) => ({
  status: 'idle',
  version: '',
  notes: '',
  error: '',
  downloadedBytes: 0,
  totalBytes: 0,

  checkForUpdates: async ({ silent = false } = {}) => {
    if (!window.__TAURI_INTERNALS__ || get().status === 'checking') return null;
    set({ status: 'checking', error: '' });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      pendingUpdate = await check();
      if (!pendingUpdate) {
        set({ status: 'idle', version: '', notes: '' });
        return null;
      }
      set({ status: 'available', version: pendingUpdate.version, notes: pendingUpdate.body || '' });
      return pendingUpdate;
    } catch (error) {
      set({ status: silent ? 'idle' : 'error', error: String(error) });
      return null;
    }
  },

  downloadAndInstall: async () => {
    if (!pendingUpdate) return;
    set({ status: 'downloading', downloadedBytes: 0, totalBytes: 0, error: '' });
    let downloadedBytes = 0;
    try {
      // The recovery snapshot must be durable before the updater is allowed to replace binaries.
      await flushRecoverySnapshot();
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') set({ totalBytes: event.data.contentLength || 0 });
        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength || 0;
          set({ downloadedBytes });
        }
        if (event.event === 'Finished') set({ status: 'ready' });
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },
}));

export default useUpdaterStore;
