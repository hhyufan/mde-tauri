import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import { setBuffer } from '@utils/editorBuffer';
import { searchFiles, cancelSearch } from '@utils/tauriApi';
import useWorkspaceSearch from './useWorkspaceSearch';
vi.mock('@utils/tauriApi', () => ({ searchFiles: vi.fn(), cancelSearch: vi.fn(() => Promise.resolve()) }));
const args = { open: true, query: 'needle', mode: 'files', scope: 'project', caseSensitive: false, includeExcluded: false };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useEditorStore.setState({ tabs: [], tabRenderList: [], tabsRevision: 0 });
  useFileStore.setState({ currentDir: 'C:/project/src', dirHistory: ['C:/project'], recentFiles: [] });
  useConfigStore.setState({ workspacePath: '' });
  searchFiles.mockResolvedValue({ results: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = async () => act(async () => { await vi.advanceTimersByTimeAsync(180); });
it('keeps project scope independent of folder navigation and supports current-folder scope', async () => {
  const { rerender } = renderHook((props) => useWorkspaceSearch(props), { initialProps: args });
  await tick(); expect(searchFiles.mock.calls[0][0]).toBe('C:/project');
  rerender({ ...args, scope: 'folder' }); await tick(); expect(searchFiles.mock.calls[1][0]).toBe('C:/project/src');
});
it('cancels debounce on clearing or closing and never runs a pending stale search', async () => {
  const { result, rerender } = renderHook((props) => useWorkspaceSearch(props), { initialProps: args });
  rerender({ ...args, query: '' }); await tick(); expect(searchFiles).not.toHaveBeenCalled();
  rerender(args); rerender({ ...args, open: false }); await tick();
  expect(searchFiles).not.toHaveBeenCalled(); expect(result.current.loading).toBe(false);
});
it('ignores obsolete errors and results while a newer request is loading', async () => {
  let rejectOld, resolveNew;
  searchFiles.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
  const { result, rerender } = renderHook((props) => useWorkspaceSearch(props), { initialProps: args });
  await tick(); rerender({ ...args, query: 'new' }); await tick();
  await act(async () => rejectOld(new Error('obsolete')));
  expect(result.current.error).toBe(''); expect(result.current.loading).toBe(true);
  expect(cancelSearch).toHaveBeenCalledTimes(1);
  await act(async () => resolveNew({ results: [{ path: 'C:/project/new.kt', name: 'new.kt', score: 0 }] }));
  expect(result.current.results[0].name).toBe('new.kt'); expect(result.current.loading).toBe(false);
});
it('replaces disk hits with unsaved buffer results, including removal of obsolete disk hits', async () => {
  const tab = { id: 'tab', name: 'main.kt', path: 'C:/project/main.kt', modified: true };
  useEditorStore.setState({ tabs: [tab], tabRenderList: [tab] }); setBuffer('tab', 'changed\nneedle');
  searchFiles.mockResolvedValue({ results: [{ name: tab.name, path: tab.path, matched_line: 'needle', line_number: 1 }] });
  const { result } = renderHook(() => useWorkspaceSearch({ ...args, mode: 'content' }));
  await tick(); expect(result.current.results).toHaveLength(1); expect(result.current.results[0].line_number).toBe(2);
  await act(async () => { setBuffer('tab', 'gone'); await vi.advanceTimersByTimeAsync(181); });
  expect(result.current.results).toHaveLength(0);
});
it('searches untitled buffers without a folder and exposes disk errors without erasing local results', async () => {
  const tab = { id: 'untitled', name: 'untitled.md', path: '' };
  useEditorStore.setState({ tabs: [tab], tabRenderList: [tab] }); setBuffer(tab.id, 'needle');
  useFileStore.setState({ currentDir: '', dirHistory: [] });
  const { result, rerender } = renderHook((props) => useWorkspaceSearch(props), { initialProps: { ...args, mode: 'content' } });
  await tick(); expect(result.current.results).toHaveLength(1); expect(searchFiles).not.toHaveBeenCalled();
  searchFiles.mockRejectedValue(new Error('Permission denied'));
  await act(async () => useFileStore.setState({ currentDir: 'C:/project', dirHistory: ['C:/project'] }));
  rerender({ ...args, mode: 'files' }); await tick();
  expect(result.current.error).toContain('Permission denied');
});
