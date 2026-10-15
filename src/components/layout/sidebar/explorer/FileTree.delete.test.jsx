import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FileTree from './FileTree';
import useFileStore from '@store/useFileStore';
import { deleteFile } from '@utils/tauriApi';
import { confirm } from '@tauri-apps/plugin-dialog';

globalThis.React = React;
const mock = vi.hoisted(() => ({ loadDirectory: vi.fn(async () => {}), notify: vi.fn() }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ loadDirectory: mock.loadDirectory }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));
vi.mock('@utils/tauriApi', () => ({ deleteFile: vi.fn(), isSafUri: () => false, safDisplayName: (path) => path }));
vi.mock('@store/useNotificationStore', () => ({ default: { getState: () => ({ notify: mock.notify }) } }));
vi.mock('@/services/syncEngine', () => ({ syncEngine: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化时要用它。缺了它，只要有依赖链把 @/i18n 拉进来
  // （测试 → useEditorStore → untitledFileName → @/i18n）就会整体报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useFileStore.setState({ currentDir: '/notes', files: [{ path: '/notes/test.md', name: 'test.md', is_dir: false }], dirHistory: ['/notes'], historyIndex: 0 });
  deleteFile.mockResolvedValue({ success: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function openConfirmation() {
  const view = render(<FileTree />);
  fireEvent.click(view.container.querySelector('.file-tree__item-del'));
  return view;
}
it('opens an in-app dialog and cancelling never invokes deletion or native confirmation', async () => {
  openConfirmation();
  expect(screen.getByRole('dialog')).toHaveTextContent('test.md');
  expect(deleteFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.explorer.cancelDelete' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(deleteFile).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});
it('waits for frontend confirmation and submits exactly once while deletion is pending', async () => {
  let complete;
  deleteFile.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  openConfirmation();
  const button = screen.getByRole('button', { name: 'sidebar.explorer.confirmDelete' });
  fireEvent.click(button); fireEvent.click(button);
  expect(deleteFile).toHaveBeenCalledExactlyOnceWith('/notes/test.md');
  expect(screen.getByRole('button', { name: 'sidebar.explorer.cancelDelete' })).toBeDisabled();
  await act(async () => complete({ success: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.loadDirectory).toHaveBeenCalledWith('/notes'); expect(confirm).not.toHaveBeenCalled();
});
it('retains the dialog for retry when deletion fails', async () => {
  deleteFile.mockResolvedValueOnce({ success: false, error: 'Access denied' });
  openConfirmation();
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.explorer.confirmDelete' }));
  await waitFor(() => expect(mock.notify).toHaveBeenCalledWith('error', 'notification.error', expect.stringContaining('Access denied')));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'sidebar.explorer.cancelDelete' })).not.toBeDisabled();
});
