import * as React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ProblemsPanel from './ProblemsPanel';
import useProblemsStore from '@store/useProblemsStore';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import i18n from '@/i18n';
globalThis.React = React;
const mock = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ openFileFromPath: mock.open }) }));
const range = { start: { line: 6, character: 3 }, end: { line: 6, character: 9 } };
beforeEach(() => {
  i18n.changeLanguage('zh');
  useProblemsStore.setState({ documents: {}, batches: {}, pendingJump: null });
  const tab = { id: 'main', name: 'main.kt', path: 'C:/Project/main.kt' };
  useEditorStore.setState({ tabs: [tab], tabRenderList: [tab], activeTabId: 'main', viewMode: 'preview' });
  useFileStore.setState({ currentDir: 'C:/Project' });
  useProblemsStore.getState().replace('lsp:kotlin', { filePath: 'C:/Project/main.kt', fileName: 'main.kt' },
    [['missing symbol', 1], ['unused variable', 4], ['weak warning', 3]].map(([message, severity]) => ({ message, severity, range })));
  useProblemsStore.getState().replace('lsp:kotlin', { filePath: 'C:/Project/other.kt', fileName: 'other.kt' }, [{ message: 'other file error', severity: 1, range }]);
  mock.open.mockReset();
});
afterEach(cleanup);
it('shows only current-file locations and severity/text filters, without a file grouping header', () => {
  render(<ProblemsPanel />);
  expect(screen.getByText('missing symbol')).toBeTruthy();
  expect(screen.getAllByText('7 行 · 4 列')).toHaveLength(3);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByText('C:/Project/main.kt')).toBeNull();
  expect(screen.queryByText('other file error')).toBeNull();
  expect(screen.getByText('unused variable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '提示', exact: true }));
  expect(screen.queryByText('unused variable')).toBeNull();
  expect(screen.getByText('weak warning')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('筛选问题'), { target: { value: 'missing' } });
  expect(screen.queryByText('weak warning')).toBeNull();
});
it('double-click selects the original unsaved/open tab and requests exact range navigation', async () => {
  render(<ProblemsPanel />);
  fireEvent.doubleClick(screen.getByText('missing symbol'));
  await waitFor(() => expect(useProblemsStore.getState().pendingJump).toMatchObject({ tabId: 'main', range }));
  expect(mock.open).not.toHaveBeenCalled();
  expect(useEditorStore.getState().viewMode).toBe('edit');
});
it('supports Enter to jump to the current file', async () => {
  render(<ProblemsPanel />);
  fireEvent.keyDown(screen.getByText('unused variable').closest('[role="button"]'), { key: 'Enter' });
  await waitFor(() => expect(useProblemsStore.getState().pendingJump?.tabId).toBe('main'));
  expect(mock.open).not.toHaveBeenCalled();
  expect(useEditorStore.getState().activeTabId).toBe('main');
});
it('shows hover details through the Tooltip component instead of native titles', async () => {
  render(<ProblemsPanel />);
  const row = screen.getByText('missing symbol').closest('[role="button"]');
  expect(row).not.toHaveAttribute('title');
  expect(screen.getByRole('button', { name: '提示', exact: true })).not.toHaveAttribute('title');
  fireEvent.mouseEnter(row);
  expect(await screen.findByText('C:/Project/main.kt:7:4')).toBeTruthy();
  expect(document.querySelector('.problems__tip')).toHaveTextContent('双击或按 Enter 跳转到代码');
});
