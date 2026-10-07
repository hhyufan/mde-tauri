import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import i18n from '@/i18n';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import useProblemsStore from '@store/useProblemsStore';
import { setBuffer } from '@utils/editorBuffer';
import SearchDropdown from './SearchDropdown';
globalThis.React = React;
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ openFileFromPath: mocks.open }) }));
vi.mock('@utils/tauriApi', () => ({ searchFiles: vi.fn(async () => ({ results: [] })), cancelSearch: vi.fn(async () => true) }));
function Harness() {
  const [open, setOpen] = useState(false);
  return <><SearchDropdown open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} /><button>outside</button></>;
}
beforeEach(() => {
  i18n.changeLanguage('zh');
  vi.clearAllMocks();
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  useFileStore.setState({ currentDir: '', dirHistory: [], recentFiles: [] });
  useConfigStore.setState({ workspacePath: '' });
  useProblemsStore.setState({ pendingJump: null });
  for (const [name, content] of [['a.kt', 'first\nval x = needle'], ['b.rs', 'fn main() {}']]) {
    useEditorStore.getState().openFile({ name, path: 'C:/project/' + name, content });
  }
});
afterEach(cleanup);
it('opens an anchored list without a modal, wraps keyboard navigation and opens an existing tab', async () => {
  render(<Harness />);
  const input = screen.getByRole('combobox', { name: '搜索' }); fireEvent.focus(input);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(within(screen.getByRole('listbox')).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(useEditorStore.getState().activeTabId).toBe('C:/project/a.kt');
  expect(mocks.open).not.toHaveBeenCalled();
});
it('supports content mode shortcut and requests a durable exact line/column jump', async () => {
  render(<Harness />);
  const input = screen.getByRole('combobox', { name: '搜索' }); fireEvent.focus(input);
  fireEvent.keyDown(input, { key: '2', altKey: true });
  fireEvent.change(input, { target: { value: 'needle' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(useProblemsStore.getState().pendingJump).toMatchObject({ tabId: 'C:/project/a.kt', range: { start: { line: 1, character: 8 }, end: { line: 1, character: 14 } } }));
  expect(useEditorStore.getState().viewMode).toBe('edit');
  expect(mocks.open).not.toHaveBeenCalled();
});
it('does not steal IME Enter and handles clearing an empty result then Escape', async () => {
  render(<Harness />);
  const input = screen.getByRole('combobox', { name: '搜索' }); fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect(screen.getByRole('listbox')).toBeTruthy();
  fireEvent.change(input, { target: { value: 'nothing' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByText('未找到结果。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('closes outside the dropdown and does not close when changing controls', async () => {
  render(<Harness />);
  fireEvent.focus(screen.getByRole('combobox', { name: '搜索' }));
  fireEvent.click(screen.getByRole('button', { name: '区分大小写' }));
  expect(screen.getByRole('listbox')).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('shows the edited buffer instead of the persisted tab snapshot', () => {
  setBuffer('C:/project/a.kt', 'unsaved needle');
  render(<Harness />); const input = screen.getByRole('combobox', { name: '搜索' }); fireEvent.focus(input);
  fireEvent.click(screen.getByRole('tab', { name: '内容', exact: true }));
  fireEvent.change(input, { target: { value: 'unsaved' } });
  expect(within(screen.getByRole('listbox')).getByRole('option')).toHaveTextContent('unsaved needle');
});
