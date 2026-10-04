import { afterEach, describe, expect, it, vi } from 'vitest';
import { appWindow, getCliArgs, onFileChanged } from './tauriApi';
import { listen } from '@tauri-apps/api/event';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
const originalBridge = window.__TAURI_INTERNALS__;
afterEach(() => {
  if (originalBridge === undefined) delete window.__TAURI_INTERNALS__;
  else window.__TAURI_INTERNALS__ = originalBridge;
  vi.clearAllMocks();
});

describe('browser startup without a Tauri bridge', () => {
  it('returns callable listener cleanup functions without accessing native APIs', async () => {
    delete window.__TAURI_INTERNALS__;
    const stopFileWatch = await onFileChanged(vi.fn());
    const stopWindowWatch = await appWindow.onResized(vi.fn());
    expect(() => { stopFileWatch(); stopWindowWatch(); }).not.toThrow();
    expect(listen).not.toHaveBeenCalled();
    expect(await getCliArgs()).toEqual([]);
  });

  it('still registers the real native file listener when Tauri is present', async () => {
    window.__TAURI_INTERNALS__ = {};
    const stop = vi.fn();
    listen.mockResolvedValueOnce(stop);
    const callback = vi.fn();
    expect(await onFileChanged(callback)).toBe(stop);
    expect(listen.mock.calls[0][0]).toBe('file-changed');
    listen.mock.calls[0][1]({ payload: { path: 'notes.mgtree' } });
    expect(callback).toHaveBeenCalledWith({ path: 'notes.mgtree' });
  });
});
