import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import { saveExistingFile } from '@/services/localFileOperations';
import { syncEngine } from '@/services/syncEngine';
import { useFileManager } from './useFileManager';

vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));
vi.mock('@/services/localFileOperations', () => ({ saveExistingFile: vi.fn() }));
vi.mock('@/services/syncEngine', () => ({
  syncEngine: { registerLocalDocument: vi.fn(), queueLocalUpsert: vi.fn(), queueExternalUpsert: vi.fn() },
  isCloudPath: () => false, fileIdFromCloudPath: () => null,
}));
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useConfigStore.setState({ autoSave: true });
  const tabs = ['a', 'b'].map((id) => ({ id, path: `/${id}.md`, name: `${id}.md`, content: 'old', encoding: 'UTF-8', modified: true }));
  useEditorStore.setState({ tabs, tabRenderList: tabs, activeTabId: 'b' });
  setBuffer('a', 'latest A'); setBuffer('b', 'latest B');
  saveExistingFile.mockImplementation(async (_path, content) => ({ success: true, savedContent: content }));
  syncEngine.queueLocalUpsert.mockResolvedValue({ ok: true });
  syncEngine.queueExternalUpsert.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); clearBuffer('a'); clearBuffer('b'); vi.useRealTimers(); });

it('saves the originating tab after switching, without canceling another pending save', async () => {
  const { result } = renderHook(useFileManager);
  act(() => { result.current.triggerAutoSave('a'); result.current.triggerAutoSave('b'); });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(saveExistingFile.mock.calls.map(([path, content]) => [path, content])).toEqual([
    ['/a.md', 'latest A'], ['/b.md', 'latest B'],
  ]);
  expect(syncEngine.queueLocalUpsert).toHaveBeenCalledTimes(2);
});

it('keeps cloud-only documents isolated when both are edited before the timer runs', async () => {
  const tabs = useEditorStore.getState().tabs.map((tab) => ({ ...tab, path: '', externalFileId: `cloud-${tab.id}` }));
  useEditorStore.setState({ tabs, tabRenderList: tabs });
  const { result } = renderHook(useFileManager);
  act(() => { result.current.triggerAutoSave('a'); result.current.triggerAutoSave('b'); });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(syncEngine.queueExternalUpsert.mock.calls.map(([id, content]) => [id, content])).toEqual([
    ['cloud-a', 'latest A'], ['cloud-b', 'latest B'],
  ]);
  expect(useEditorStore.getState().tabRenderList.every((tab) => !tab.modified)).toBe(true);
});
