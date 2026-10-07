import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import { historyCapture } from '@utils/tauriApi';
import { clearBuffer } from '@utils/editorBuffer';
import { clearDiskBaselines } from '@/services/localFileGuard';
import { useFileManager } from './useFileManager';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/services/syncEngine', () => ({
  syncEngine: { registerLocalDocument: vi.fn() },
  isCloudPath: (path) => path.startsWith('cloud://'),
  fileIdFromCloudPath: (path) => path.slice(8),
}));
vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));

const path = 'C:\\notes\\unchanged.txt';
beforeEach(() => {
  vi.clearAllMocks();
  clearBuffer(path);
  clearDiskBaselines();
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  useFileStore.setState({ currentDir: '' });
  invoke.mockImplementation(async (command) => {
    if (command === 'read_file_content') return { success: true, content: 'unchanged' };
    if (command === 'get_file_info') return { size: 9 };
    if (['history_capture', 'start_file_watching'].includes(command)) return;
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(() => {
  clearBuffer(path);
  clearDiskBaselines();
});

it('forces the opening baseline once, and forces a new baseline after closing and reopening', async () => {
  const { result } = renderHook(() => useFileManager());
  await act(() => result.current.openFileFromPath(path, 'unchanged.txt'));
  expect(invoke).toHaveBeenCalledWith('history_capture', { filePath: path, content: 'unchanged', force: true });
  await act(() => result.current.openFileFromPath(path, 'unchanged.txt'));
  expect(invoke.mock.calls.filter(([command]) => command === 'history_capture')).toHaveLength(1);
  act(() => useEditorStore.getState().closeTab(path));
  await act(() => result.current.openFileFromPath(path, 'unchanged.txt'));
  const captures = invoke.mock.calls.filter(([command]) => command === 'history_capture');
  expect(captures.map(([, args]) => args.force)).toEqual([true, false, true]);
});

it('keeps periodic and exit captures deduplicated by default', async () => {
  await historyCapture(path, 'unchanged');
  expect(invoke).toHaveBeenCalledWith('history_capture', { filePath: path, content: 'unchanged', force: false });
});

it('passes the rollback source and forced capture through the native bridge', async () => {
  await historyCapture(path, 'restored', { force: true, restoredFrom: 123 });
  expect(invoke).toHaveBeenCalledWith('history_capture', {
    filePath: path, content: 'restored', force: true, restoredFrom: 123,
  });
});
