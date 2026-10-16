import { create } from 'zustand';
import { canCheckUpdates, checkForUpdate, installUpdate, relaunchApp } from '@utils/appUpdater';

let startupChecked = false;
let updateResource = null;
const busy = (stage) => ['checking', 'downloading', 'installing'].includes(stage);
const releaseResource = async () => {
  const resource = updateResource;
  updateResource = null;
  await resource?.close().catch(() => {});
};

const useUpdateStore = create((set, get) => ({
  stage: 'idle',
  open: false,
  version: '',
  body: '',
  error: '',
  downloaded: 0,
  total: 0,
  check: async ({ startup = false } = {}) => {
    if (!canCheckUpdates()) return;
    if (startup) {
      if (startupChecked) return;
      startupChecked = true;
    }
    if (busy(get().stage)) {
      if (!startup) set({ open: true });
      return;
    }
    if (get().stage === 'installed') {
      set({ open: true });
      return;
    }
    set({
      stage: 'checking',
      open: !startup,
      error: '',
      version: '',
      body: '',
      downloaded: 0,
      total: 0,
    });
    try {
      await releaseResource();
      updateResource = await checkForUpdate();
      if (updateResource) {
        set({
          stage: 'available',
          open: true,
          version: updateResource.version,
          body: updateResource.body || '',
        });
      } else set({ stage: 'up-to-date' });
    } catch (error) {
      set({ stage: 'error', error: String(error?.message || error) });
    }
  },
  dismiss: () => {
    if (busy(get().stage)) return;
    set({ open: false });
    if (get().stage !== 'installed') void releaseResource();
  },
  install: async () => {
    if (get().stage !== 'available' || !updateResource) return;
    set({ stage: 'downloading', error: '' });
    try {
      await installUpdate(updateResource, (stage, detail = {}) => set({ stage, ...detail }));
      set({ stage: 'installed' });
      await releaseResource();
    } catch (error) {
      set({ stage: 'error', error: String(error?.message || error) });
      await releaseResource();
    }
  },
  restart: async () => {
    if (get().stage !== 'installed') return;
    try {
      await relaunchApp();
    } catch (error) {
      set({ error: String(error?.message || error) });
    }
  },
}));

export default useUpdateStore;
