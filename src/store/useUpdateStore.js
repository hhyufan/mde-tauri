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
      // 已经在跑了：只把面板打开让用户看到进度，不重复发起检查。
      if (manual) set({ open: true });
      return;
    }
    set({
      stage: 'checking',
      // 任务列表默认隐藏，只有用户点击状态栏才展开：这里不自动 open。
      // 检查过程中的进展由状态栏那个圆环转圈体现。
      open: false,
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
        // 发现新版本同样不自动展开面板，由状态栏露出"有可用更新"，
        // 用户点开就能看到版本对比、更新说明与安装按钮。
        set({
          stage: 'available',
          open: false,
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
      // 同样不自动展开面板。手动检查失败必须让人知道，所以给一条会自动消失的
      // 通知（重试按钮在任务列表里，点状态栏即可打开）；启动时的静默检查保持安静。
      set({ stage: 'error', open: false, error: String(error?.message || error) });
      if (manual) {
        useNotificationStore.getState().notify('error', i18n.t('notification.updateFailed'), String(error?.message || error));
      }
    }
  },
  dismiss: () => {
    set({ open: false });
    // Keep the available update usable when the task list is reopened.
  },
  // 关掉更新这条任务：回到空闲并释放已经拿到的更新资源。
  // 面板是否展开由用户控制，这里不动 open。
  reset: async () => {
    set({ stage: 'idle', version: '', body: '', error: '', downloaded: 0, total: 0 });
    await releaseResource();
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
