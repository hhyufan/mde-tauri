import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useFileStore from '@store/useFileStore';
import { getDirectoryContents, onDirectoryChanged, startDirectoryWatching, stopDirectoryWatching } from '@utils/tauriApi';
import { useWorkspaceDirectory } from './useWorkspaceDirectory';
import { useFileManager } from './useFileManager';

vi.mock('@utils/tauriApi', async (importOriginal) => ({
  ...await importOriginal(),
  getDirectoryContents: vi.fn(),
  isSafUri: (path) => path.startsWith('content://'),
  onDirectoryChanged: vi.fn(),
  startDirectoryWatching: vi.fn(),
  stopDirectoryWatching: vi.fn(),
}));
vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));
vi.mock('@/services/syncEngine', () => ({ syncEngine: {}, isCloudPath: () => false, fileIdFromCloudPath: () => null }));

let changed;
let stopListening;
const settle = () => act(async () => {});
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  stopListening = vi.fn();
  onDirectoryChanged.mockImplementation((callback) => {
    changed = callback;
    return Promise.resolve(stopListening);
  });
  startDirectoryWatching.mockResolvedValue(true);
  stopDirectoryWatching.mockResolvedValue(true);
  getDirectoryContents.mockResolvedValue([]);
  useFileStore.setState({ currentDir: '/notes', files: [], sortBy: 'name', sortOrder: 'asc' });
});
afterEach(async () => { cleanup(); await settle(); vi.useRealTimers(); });

it('keeps one watcher and one refresh subscription when multiple components consume file actions', async () => {
  renderHook(() => {
    useWorkspaceDirectory(false);
    useFileManager();
    useFileManager();
  });
  await settle();
  expect(startDirectoryWatching).toHaveBeenCalledTimes(1);
  expect(onDirectoryChanged).toHaveBeenCalledTimes(1);
});

it('keeps the active watcher alive after the StrictMode setup/cleanup cycle', async () => {
  const { unmount } = renderHook(() => useWorkspaceDirectory(false), {
    wrapper: ({ children }) => createElement(StrictMode, null, children),
  });
  await settle();
  expect(startDirectoryWatching).toHaveBeenCalledTimes(1);
  expect(stopDirectoryWatching).not.toHaveBeenCalled();
  unmount();
  await settle();
  expect(stopDirectoryWatching).toHaveBeenCalledTimes(1);
});

it('coalesces a burst of native events into one directory read without changing navigation history', async () => {
  const history = useFileStore.getState().dirHistory;
  const files = [{ name: 'note10' }, { name: 'note2' }, { name: 'folder', is_dir: true }];
  getDirectoryContents.mockResolvedValue(files);
  const { unmount } = renderHook(() => useWorkspaceDirectory(false));
  await settle();
  expect(startDirectoryWatching).toHaveBeenCalledTimes(1);
  act(() => {
    for (let i = 0; i < 20; i += 1) changed({ dir: '/notes' });
    changed({ dir: '/other' });
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(getDirectoryContents).toHaveBeenCalledTimes(1);
  expect(useFileStore.getState().files.map((item) => item.name)).toEqual(['folder', 'note2', 'note10']);
  expect(useFileStore.getState().dirHistory).toBe(history);
  unmount();
  await settle();
  expect(stopListening).toHaveBeenCalledTimes(1);
  expect(stopDirectoryWatching).toHaveBeenCalledWith('/notes');
});

it('does not publish an old directory read after navigation', async () => {
  let finish;
  getDirectoryContents.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  renderHook(() => useWorkspaceDirectory(false));
  await settle();
  act(() => changed({ dir: '/notes' }));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  act(() => useFileStore.setState({ currentDir: '/other', files: [{ name: 'current' }] }));
  await act(async () => finish([{ name: 'stale' }]));
  expect(useFileStore.getState().files).toEqual([{ name: 'current' }]);
});

it('serializes slow starts and stops even when navigation returns to the same path', async () => {
  let finishStart;
  startDirectoryWatching.mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve; }));
  renderHook(() => useWorkspaceDirectory(false));
  await settle();
  act(() => useFileStore.setState({ currentDir: '/other' }));
  act(() => useFileStore.setState({ currentDir: '/notes' }));
  expect(startDirectoryWatching).toHaveBeenCalledTimes(1);
  await act(async () => finishStart(true));
  expect(stopDirectoryWatching).toHaveBeenCalledTimes(1);
  expect(startDirectoryWatching.mock.calls).toEqual([['/notes'], ['/notes']]);
  expect(stopDirectoryWatching.mock.invocationCallOrder[0]).toBeLessThan(startDirectoryWatching.mock.invocationCallOrder[1]);
});

it('does not overlap reads when new changes arrive during slow IO', async () => {
  let finish;
  getDirectoryContents.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  getDirectoryContents.mockResolvedValueOnce([{ name: 'latest' }]);
  renderHook(() => useWorkspaceDirectory(false));
  await settle();
  act(() => changed({ dir: '/notes' }));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  act(() => changed({ dir: '/notes' }));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(getDirectoryContents).toHaveBeenCalledTimes(1);
  await act(async () => finish([{ name: 'old' }]));
  expect(getDirectoryContents).toHaveBeenCalledTimes(2);
  expect(useFileStore.getState().files).toEqual([{ name: 'latest' }]);
});

it.each([[true, '/notes'], [false, 'content://documents'], [false, '']])('skips native watching for Android/SAF/empty directories (%s, %s)', async (android, path) => {
  useFileStore.setState({ currentDir: path });
  renderHook(() => useWorkspaceDirectory(android));
  await settle();
  expect(startDirectoryWatching).not.toHaveBeenCalled();
  expect(onDirectoryChanged).not.toHaveBeenCalled();
});
