import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ init: vi.fn(), imported: vi.fn(), component: () => null }));
vi.mock('./monacoShiki', () => ({ initMonacoShiki: mock.init }));
vi.mock('../components/editor/MonacoEditor', () => {
  mock.imported();
  return { default: mock.component };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.init.mockResolvedValue(undefined);
});

it('loads component code in parallel with highlighting but only exposes a safe editor', async () => {
  let finish;
  mock.init.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const boot = await import('./monacoRuntimeBoot');
  const preload = boot.preloadMonacoEditor();
  expect(boot.preloadMonacoEditor()).toBe(preload);
  await vi.waitFor(() => expect(mock.init).toHaveBeenCalledOnce());
  expect(mock.imported).toHaveBeenCalledOnce();
  expect(boot.getLoadedMonacoEditor()).toBeNull();
  finish();
  expect(await preload).toEqual({ default: mock.component });
  expect(boot.getLoadedMonacoEditor()).toBe(mock.component);
  expect(boot.preloadMonacoEditor()).toBe(preload);
});

it('allows an editor mount to retry a failed startup preload', async () => {
  mock.init.mockRejectedValueOnce(new Error('resource unavailable'));
  const boot = await import('./monacoRuntimeBoot');
  await expect(boot.preloadMonacoEditor()).rejects.toThrow('resource unavailable');
  expect(boot.getLoadedMonacoEditor()).toBeNull();
  await boot.preloadMonacoEditor();
  expect(mock.init).toHaveBeenCalledTimes(2);
  expect(boot.getLoadedMonacoEditor()).toBe(mock.component);
});
