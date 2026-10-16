import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@utils/appUpdater', () => ({
  canCheckUpdates: vi.fn(() => true),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

let store;
let api;
let resource;
beforeEach(async () => {
  vi.resetModules();
  api = await import('@utils/appUpdater');
  vi.clearAllMocks();
  api.canCheckUpdates.mockReturnValue(true);
  resource = { version: '1.2.3', body: 'Release notes', close: vi.fn().mockResolvedValue() };
  api.checkForUpdate.mockResolvedValue(resource);
  store = (await import('./useUpdateStore')).default;
});

it('checks once across startup remounts and never downloads without consent', async () => {
  await Promise.all([
    store.getState().check({ startup: true }),
    store.getState().check({ startup: true }),
  ]);
  expect(api.checkForUpdate).toHaveBeenCalledTimes(1);
  expect(store.getState()).toMatchObject({
    stage: 'available',
    // 任务列表默认隐藏：发现新版本也不自动展开，由状态栏露出提示，点击才展开。
    open: false,
    version: '1.2.3',
    body: 'Release notes',
  });
  expect(api.installUpdate).not.toHaveBeenCalled();
  store.getState().dismiss();
  expect(resource.close).not.toHaveBeenCalled();
  store.getState().showTasks();
  expect(store.getState().open).toBe(true);
  expect(api.installUpdate).not.toHaveBeenCalled();
});

it('keeps automatic success and network failure quiet; manual checks show results', async () => {
  api.checkForUpdate.mockResolvedValueOnce(null);
  await store.getState().check({ startup: true });
  expect(store.getState()).toMatchObject({ stage: 'up-to-date', open: false });

  // 手动检查失败要让人知道，但不能靠自动弹面板，改给一条会自动消失的通知。
  const notificationStore = (await import('@store/useNotificationStore')).default;
  notificationStore.setState({ notifications: [] });
  api.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
  await store.getState().check();
  expect(store.getState()).toMatchObject({ stage: 'error', open: false, error: 'offline' });
  expect(notificationStore.getState().notifications).toHaveLength(1);
  expect(notificationStore.getState().notifications[0].type).toBe('error');
});

it('手动检查发现已是最新时不留弹窗，只在右上角给一条会自动消失的通知', async () => {
  const notificationStore = (await import('@store/useNotificationStore')).default;
  notificationStore.setState({ notifications: [] });
  api.checkForUpdate.mockResolvedValueOnce(null);

  await store.getState().check();

  expect(store.getState()).toMatchObject({ stage: 'up-to-date', open: false });
  expect(notificationStore.getState().notifications).toHaveLength(1);
});

it('手动检查过程中也不自动展开任务列表', async () => {
  // 用一个受控的 promise 把检查卡在"进行中"，再断言此刻的状态。
  // 注意不要用 mockImplementationOnce 之后再去取 resolve：check() 里
  // await releaseResource() 会让 checkForUpdate 晚一个微任务才被调用。
  let resolveUpdate;
  const gate = new Promise((resolve) => {
    resolveUpdate = resolve;
  });
  api.checkForUpdate.mockImplementationOnce(() => gate);

  const pending = store.getState().check();
  // 进度改由状态栏的圆环体现；面板保持隐藏，等用户点击才展开。
  expect(store.getState()).toMatchObject({ stage: 'checking', open: false });
  expect(store.getState().showTasks).toBeTypeOf('function');
  store.getState().showTasks();
  expect(store.getState().open).toBe(true);

  resolveUpdate(null);
  await pending;
});

it('启动时的静默检查不打开任务列表', async () => {
  let resolveUpdate;
  const gate = new Promise((resolve) => {
    resolveUpdate = resolve;
  });
  api.checkForUpdate.mockImplementationOnce(() => gate);

  // 每个用例都重新 import 模块，startupChecked 是模块级变量，所以这里能真的跑起来
  const pending = store.getState().check({ startup: true });
  expect(store.getState()).toMatchObject({ stage: 'checking', open: false });

  resolveUpdate(null);
  await pending;
});

it('keeps startup failure quiet and permits a later manual retry', async () => {
  api.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
  await store.getState().check({ startup: true });
  expect(store.getState()).toMatchObject({ stage: 'error', open: false });
  await store.getState().check();
  expect(store.getState()).toMatchObject({ stage: 'available', open: false });
});

it('installs only on consent, ignores double clicks and hands off automatically', async () => {
  let finish;
  api.installUpdate.mockImplementation((_resource, progress) => {
    progress('downloading', { downloaded: 50, total: 100 });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await store.getState().check();
  const installing = store.getState().install();
  await store.getState().install();
  store.getState().dismiss();
  expect(store.getState()).toMatchObject({
    open: false,
    stage: 'downloading',
    downloaded: 50,
    total: 100,
  });
  expect(api.installUpdate).toHaveBeenCalledTimes(1);
  expect(resource.close).not.toHaveBeenCalled();
  store.getState().showTasks();
  expect(store.getState().open).toBe(true);
  finish();
  await installing;
  expect(store.getState().stage).toBe('restarting');
  expect(api.relaunchApp).toHaveBeenCalledTimes(1);
});

it('releases failed downloads and reacquires the update when retrying', async () => {
  await store.getState().check();
  api.installUpdate.mockRejectedValueOnce(new Error('network lost'));
  await store.getState().install();
  expect(store.getState()).toMatchObject({ stage: 'error', error: 'network lost' });
  expect(resource.close).toHaveBeenCalled();
  await store.getState().check();
  expect(store.getState().stage).toBe('available');
});

it('does not check on unsupported platforms', async () => {
  api.canCheckUpdates.mockReturnValue(false);
  await store.getState().check({ startup: true });
  expect(api.checkForUpdate).not.toHaveBeenCalled();
});
