import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import { clearBuffer, getBuffer, setBuffer } from '@utils/editorBuffer';
import { clearDiskBaselines } from '@/services/localFileGuard';
import { useFileManager } from './useFileManager';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
const language = vi.hoisted(() => ({ current: 'en' }));
vi.mock('@/i18n', () => ({ default: { t: (key) => key === 'file.untitledName' ? (language.current === 'zh' ? '未命名.md' : 'Untitled.md') : key } }));
vi.mock('@/services/syncEngine', () => ({
  syncEngine: { registerLocalDocument: vi.fn(), queueLocalUpsert: vi.fn(async () => ({ ok: true })) },
  isCloudPath: () => false, fileIdFromCloudPath: () => null,
}));
let disk;
beforeEach(() => {
  vi.clearAllMocks(); language.current = 'en'; disk = new Map(); clearDiskBaselines();
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null, sidebarVisible: false, sidebarView: 'outline' });
  useFileStore.setState({ currentDir: '', files: [], recentFiles: [] });
  useConfigStore.setState({ autoSave: true });
  invoke.mockImplementation(async (command, args) => {
    if (command === 'check_file_exists') return disk.has(args.path);
    if (command === 'write_file_content') { disk.set(args.path, args.content); return; }
    if (command === 'save_file') { disk.set(args.filePath, args.content); return { success: true }; }
    if (command === 'read_file_content') return { success: true, content: disk.get(args.filePath) || '', encoding: 'UTF-8' };
    if (command === 'get_directory_contents') return [];
    if (command === 'get_file_info') return { size: 0 };
    if (['history_capture', 'start_file_watching', 'stop_file_watching'].includes(command)) return;
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => { cleanup(); for (const tab of useEditorStore.getState().tabs) clearBuffer(tab.id); vi.restoreAllMocks(); });

it('creates an empty Markdown file in the open directory even when Explorer is hidden', async () => {
  useFileStore.setState({ currentDir: 'C:\\notes' });
  const { result } = renderHook(useFileManager);
  await act(async () => result.current.createNewTab());
  expect(disk.get('C:\\notes\\Untitled.md')).toBe('');
  expect(useEditorStore.getState().getActiveTab()).toMatchObject({ path: 'C:\\notes\\Untitled.md', ext: 'md' });
  expect(open).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});

it('serializes rapid new-tab clicks and never replaces an existing file', async () => {
  useFileStore.setState({ currentDir: '/notes' }); disk.set('/notes/Untitled.md', 'keep me');
  const { result } = renderHook(useFileManager);
  await act(async () => Promise.all([result.current.createNewTab(), result.current.createNewTab()]));
  expect([...disk.entries()]).toEqual([['/notes/Untitled.md', 'keep me'], ['/notes/Untitled (2).md', ''], ['/notes/Untitled (3).md', '']]);
  expect(useEditorStore.getState().tabs).toHaveLength(2);
});

it('creates unique temporary Markdown tabs without opening a dialog or writing files', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1234);
  const { result } = renderHook(useFileManager);
  await act(async () => { await result.current.createNewTab(); await result.current.createNewTab(); });
  const tabs = useEditorStore.getState().tabs;
  expect(new Set(tabs.map((tab) => tab.id)).size).toBe(2);
  expect(tabs.every((tab) => !tab.path && tab.name.endsWith('.md') && tab.ext === 'md')).toBe(true);
  expect(disk.size).toBe(0); expect(save).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});

it('keeps a temporary file in memory until manual Save chooses a path, then writes the latest text', async () => {
  const { result } = renderHook(useFileManager);
  await act(async () => result.current.createNewTab());
  const tab = useEditorStore.getState().getActiveTab(); setBuffer(tab.id, 'latest draft');
  act(() => result.current.triggerAutoSave(tab.id));
  expect(save).not.toHaveBeenCalled(); expect(disk.size).toBe(0);
  // Opening a directory later must not silently choose a destination for this draft.
  useFileStore.setState({ currentDir: '/notes' });
  useEditorStore.setState({ sidebarVisible: true, sidebarView: 'explorer' });
  save.mockResolvedValueOnce('/chosen/my-note.md');
  await act(async () => result.current.saveTab(tab.id));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: tab.name }));
  expect(disk.get('/chosen/my-note.md')).toBe('latest draft');
  expect(useEditorStore.getState().getActiveTab()).toMatchObject({ path: '/chosen/my-note.md', modified: false });
});

it('keeps the draft and its text when the Save dialog is cancelled', async () => {
  const { result } = renderHook(useFileManager); await act(async () => result.current.createNewTab());
  const tab = useEditorStore.getState().getActiveTab(); setBuffer(tab.id, 'unsaved text'); save.mockResolvedValueOnce(null);
  await act(async () => { expect(await result.current.saveTab(tab.id)).toMatchObject({ cancelled: true }); });
  expect(useEditorStore.getState().getActiveTab().path).toBe('');
  expect(getBuffer(tab.id)).toBe('unsaved text'); expect(disk.size).toBe(0);
});

it('uses the directory captured when + was clicked without switching the user back to it', async () => {
  useFileStore.setState({ currentDir: '/first' });
  const { result } = renderHook(useFileManager);
  await act(async () => { const creating = result.current.createNewTab(); useFileStore.setState({ currentDir: '/second' }); await creating; });
  expect(disk.has('/first/Untitled.md')).toBe(true);
  expect(useFileStore.getState().currentDir).toBe('/second');
});

it.each(['zh', 'en'])('localizes both disk and temporary default names for %s', async (lng) => {
  language.current = lng;
  const name = lng === 'zh' ? '未命名.md' : 'Untitled.md';
  const { result } = renderHook(useFileManager);
  await act(async () => result.current.createNewTab());
  expect(useEditorStore.getState().getActiveTab().name).toBe(name);
  useFileStore.setState({ currentDir: '/notes' });
  await act(async () => result.current.createNewTab());
  expect(disk.has(`/notes/${name}`)).toBe(true);
});
