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
    open: true,
    version: '1.2.3',
    body: 'Release notes',
  });
  expect(api.installUpdate).not.toHaveBeenCalled();
  store.getState().dismiss();
  expect(resource.close).toHaveBeenCalledTimes(1);
  expect(api.installUpdate).not.toHaveBeenCalled();
});

it('keeps automatic success and network failure quiet; manual checks show results', async () => {
  api.checkForUpdate.mockResolvedValueOnce(null);
  await store.getState().check({ startup: true });
  expect(store.getState()).toMatchObject({ stage: 'up-to-date', open: false });
  api.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
  await store.getState().check();
  expect(store.getState()).toMatchObject({ stage: 'error', open: true, error: 'offline' });
});

it('keeps startup failure quiet and permits a later manual retry', async () => {
  api.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
  await store.getState().check({ startup: true });
  expect(store.getState()).toMatchObject({ stage: 'error', open: false });
  await store.getState().check();
  expect(store.getState()).toMatchObject({ stage: 'available', open: true });
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
    open: true,
    stage: 'downloading',
    downloaded: 50,
    total: 100,
  });
  expect(api.installUpdate).toHaveBeenCalledTimes(1);
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
