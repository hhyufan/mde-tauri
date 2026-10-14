import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { announceMainWindowReady } from './startupHandover';

let invoke;
beforeEach(() => {
  vi.useFakeTimers();
  invoke = vi.fn().mockResolvedValue(undefined);
  window.__TAURI_INTERNALS__ = { invoke };
  document.documentElement.dataset.theme = 'dark';
});
afterEach(() => {
  vi.useRealTimers();
  delete window.__TAURI_INTERNALS__;
  delete document.documentElement.dataset.theme;
});

it('hands over as soon as the editor is ready and passes the theme', async () => {
  announceMainWindowReady(Promise.resolve());
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('main_window_ready', { dark: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(invoke).toHaveBeenCalledOnce();
});

it('bounds a stalled preload and ignores its later completion', async () => {
  let complete;
  announceMainWindowReady(new Promise((resolve) => { complete = resolve; }));
  await vi.advanceTimersByTimeAsync(1499);
  expect(invoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(invoke).toHaveBeenCalledOnce();
  complete();
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledOnce();
});

it('cancels the obsolete effect during StrictMode remounting', async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const cancel = announceMainWindowReady(pending);
  cancel();
  announceMainWindowReady(pending);
  complete();
  await vi.advanceTimersByTimeAsync(2000);
  expect(invoke).toHaveBeenCalledOnce();
});

it('does nothing outside a native window', async () => {
  delete window.__TAURI_INTERNALS__;
  const cancel = announceMainWindowReady(Promise.resolve());
  cancel();
  await vi.advanceTimersByTimeAsync(2000);
  expect(invoke).not.toHaveBeenCalled();
});
