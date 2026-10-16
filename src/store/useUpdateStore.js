import { create } from 'zustand';
import i18n from '@/i18n';
import { canCheckUpdates, checkForUpdate, installUpdate, relaunchApp } from '@utils/appUpdater';
import useNotificationStore from '@store/useNotificationStore';

let startupChecked = false;
let updateResource = null;
const busy = (stage) => ['checking', 'downloading', 'installing', 'restarting'].includes(stage);
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
    const manual = !startup;
    if (startup) {
      if (startupChecked) return;
      startupChecked = true;
    }
    if (busy(get().stage)) {
      if (manual) set({ open: true });
      return;
    }
    set({
      stage: 'checking',
      // 手动检查也要在任务列表里看得见——它已经是非模态面板，不是弹窗，
      // 所以不用担心"闪一下再关掉"。启动时的静默检查不打扰用户。
      open: manual,
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
      } else {
        // 已是最新版本：这种事不该用一个还得手动关闭的弹窗来告知。
        // 用右上角那套通知（NotificationContainer），它会自己消失。
        // 启动时的静默检查不给提示——否则每次开机都弹一句"已是最新版本"。
        set({ stage: 'up-to-date', open: false });
        if (manual) useNotificationStore.getState().notify('info', i18n.t('notification.upToDate'));
      }
    } catch (error) {
      // 手动检查的失败要让人看见；启动时的静默检查保持安静。
      set({ stage: 'error', open: manual, error: String(error?.message || error) });
    }
  },
  dismiss: () => {
    set({ open: false });
    // Keep the available update usable when the task list is reopened.
  },
  showTasks: () => set({ open: true }),
  install: async () => {
    if (get().stage !== 'available' || !updateResource) return;
    set({ stage: 'downloading', open: true, error: '' });
    try {
      await installUpdate(updateResource, (stage, detail = {}) => set({ stage, ...detail }));
      set({ stage: 'restarting' });
      await releaseResource();
      await relaunchApp();
    } catch (error) {
      set({ stage: 'error', open: true, error: String(error?.message || error) });
      await releaseResource();
    }
  },
}));

export default useUpdateStore;
