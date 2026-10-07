import * as React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import { clearBuffer, getBuffer } from '@utils/editorBuffer';
import { historyCapture, historyList, historyRead } from '@utils/tauriApi';
import Timeline from './Timeline';
import HistoryDiffView from './HistoryDiffView';

globalThis.React = React;
const mock = vi.hoisted(() => ({ saveTab: vi.fn(), init: vi.fn(), createDiff: vi.fn(), diff: null, models: [], changes: [], splitOffset: 400,
  selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ saveTab: mock.saveTab }) }));
vi.mock('@utils/tauriApi', () => ({
  historyCapture: vi.fn(async () => {}), historyList: vi.fn(), historyRead: vi.fn(),
  onHistoryChanged: vi.fn(async () => () => {}),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, params) => ({
  'history.title': '本地历史', 'history.restore': '恢复此版本', 'history.closeDiff': '关闭对比',
  'history.rollback': '回滚记录', 'history.rollbackFrom': `已回滚至 ${params?.time} 的版本`,
  'history.restoreSelection': '恢复选中差异', 'history.applyChanges': '应用修改',
  'history.current': '现在',
  'history.noChanges': '没有更改',
}[key] || key) }) }));
vi.mock('monaco-editor', () => ({ editor: {
  createDiffEditor: (...args) => mock.createDiff(...args),
  createModel: (initial) => {
    let value = initial, version = 1;
    const listeners = new Set();
    const model = {
      getValue: () => value, getVersionId: () => version,
      getFullModelRange: () => ({}),
      setValue: (next) => { value = next; version++; listeners.forEach((fn) => fn()); mock.diff?.updated(); },
      onDidChangeContent: (fn) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
      dispose: vi.fn(),
    };
    mock.models.push(model);
    return model;
  }, setTheme() {}, setModelLanguage() {},
} }));
vi.mock('@utils/monacoShiki', () => ({
  initMonacoShiki: () => mock.init(), getMonacoThemeName: () => 'one-light',
}));

const path = 'C:/notes/rollback.txt';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  mock.splitOffset = 400;
  mock.diff = null;
  mock.models = [];
  mock.changes = [{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }];
  mock.selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
  mock.init.mockResolvedValue();
  mock.createDiff.mockImplementation(() => {
    const updates = new Set();
    const layouts = new Set();
    const editor = (side) => ({
      onDidLayoutChange: (fn) => { layouts.add(fn); return { dispose: () => layouts.delete(fn) }; },
      getContainerDomNode: () => ({ getBoundingClientRect: () => ({ left: mock.splitOffset }) }),
      onDidFocusEditorText: () => ({ dispose() {} }), getSelection: () => mock.selection,
      pushUndoStop: vi.fn(), executeEdits: (_source, edits) => mock.models[side].setValue(edits[0].text),
    });
    const diff = {
      getOriginalEditor: () => editor(0), getModifiedEditor: () => editor(1),
      onDidUpdateDiff: (fn) => { updates.add(fn); return { dispose: () => updates.delete(fn) }; },
      getLineChanges: () => mock.changes,
      updated: () => queueMicrotask(() => updates.forEach((fn) => fn())),
      layoutUpdated: () => layouts.forEach((fn) => fn()),
      setModel: () => diff.updated(), updateOptions() {}, dispose: vi.fn(),
    };
    mock.diff = diff;
    return diff;
  });
  clearBuffer(path);
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  useEditorStore.getState().openFile({ path, name: 'rollback.txt', content: 'before' });
  useHistoryStore.setState({ diff: null });
  historyList.mockResolvedValue([{ timestamp: 20, bytes: 5, restoredFrom: 10 }, { timestamp: 10, bytes: 5 }]);
  historyRead.mockResolvedValue('older');
  mock.saveTab.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); clearBuffer(path); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows a rollback icon and its source on the marked entry, while old plain entries remain selectable', async () => {
  render(<Timeline />);
  const icon = await screen.findByRole('img', { name: '回滚记录' });
  expect(screen.getAllByRole('img', { name: '回滚记录' })).toHaveLength(1);
  expect(icon).not.toHaveAttribute('title');
  fireEvent.mouseEnter(icon);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(new Date(10).toLocaleString());
  fireEvent.click(icon.closest('button'));
  await waitFor(() => expect(useHistoryStore.getState().diff).toEqual({ tabId: path, timestamp: 20, content: 'older' }));
  expect(historyRead).toHaveBeenCalledWith(path, 20);
});

it.each(['before', 'older', 'older\n\n'])('records every successful rollback even from content %j', async (current) => {
  useEditorStore.getState().replaceTabContent(path, { content: current });
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'older' } });
  render(<HistoryDiffView />);
  fireEvent.click(screen.getByRole('button', { name: '恢复此版本' }));
  await waitFor(() => expect(useHistoryStore.getState().diff).toBeNull());
  expect(historyCapture.mock.calls).toEqual([
    [path, current], [path, 'older', { force: true, restoredFrom: 10 }],
  ]);
  expect(mock.saveTab).toHaveBeenCalledWith(path);
  expect(getBuffer(path)).toBe('older');
  expect(historyCapture.mock.invocationCallOrder[1]).toBeGreaterThan(mock.saveTab.mock.invocationCallOrder[0]);
});

it('waits for a successful save before labeling a rollback, and keeps the diff open if saving fails', async () => {
  let finish;
  mock.saveTab.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'older' } });
  render(<HistoryDiffView />);
  fireEvent.click(screen.getByRole('button', { name: '恢复此版本' }));
  await waitFor(() => expect(mock.saveTab).toHaveBeenCalled());
  expect(historyCapture).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: false }));
  expect(historyCapture).toHaveBeenCalledTimes(1);
  expect(useHistoryStore.getState().diff).not.toBeNull();
  expect(screen.getByRole('button', { name: '恢复此版本' })).toBeEnabled();
});

it('lets selected lines be restored into a draft, preserving other edits until Apply is clicked', async () => {
  useEditorStore.getState().replaceTabContent(path, { content: 'a\nB\nC' });
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'a\nb\nc' } });
  mock.changes = [{ originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 2, modifiedEndLineNumber: 3 }];
  mock.selection = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 };
  render(<HistoryDiffView />);
  await waitFor(() => expect(screen.getByRole('button', { name: '恢复选中差异' })).toBeEnabled());
  expect(mock.createDiff.mock.calls[0][1]).toMatchObject({ readOnly: false, originalEditable: false, renderMarginRevertIcon: true });
  fireEvent.click(screen.getByRole('button', { name: '恢复选中差异' }));
  expect(getBuffer(path)).toBe('a\nB\nC');
  expect(historyCapture).not.toHaveBeenCalled();
  expect(mock.models[1].getValue()).toBe('a\nb\nC');
  fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
  await waitFor(() => expect(useHistoryStore.getState().diff).toBeNull());
  expect(getBuffer(path)).toBe('a\nb\nC');
  expect(historyCapture).toHaveBeenLastCalledWith(path, 'a\nb\nC', { force: true });
});

it('uses icon-only actions and the shared tooltip even while Apply is disabled', async () => {
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'older' } });
  const { container } = render(<HistoryDiffView />);
  for (const name of ['关闭对比', '恢复选中差异', '应用修改', '恢复此版本']) {
    const button = screen.getByRole('button', { name });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();
  }
  expect(container.querySelector('[title]')).toBeNull();
  const apply = screen.getByRole('button', { name: '应用修改' });
  expect(apply).toBeDisabled();
  fireEvent.mouseEnter(apply.parentElement);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('应用修改');
});

it('shows the historical content hash and time on the left, Now on the right, and follows the split', async () => {
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'abc' } });
  const { container } = render(<HistoryDiffView />);
  const left = screen.getByRole('group', { name: '本地历史' });
  const right = screen.getByRole('group', { name: '现在' });
  await waitFor(() => expect(left.querySelector('code')).toHaveTextContent('ba7816bf'));
  expect(left).toHaveTextContent('rollback.txt');
  expect(left.querySelector('time')).toHaveAttribute('datetime', new Date(10).toISOString());
  expect(left.querySelector('time')).toHaveTextContent(new Date(10).toLocaleString());
  expect(right).toHaveTextContent('rollback.txt现在');
  expect(right.querySelector('time, code')).toBeNull();
  expect(container.querySelector('.history-diff__hint')).toBeNull();
  const headers = container.querySelector('.history-diff__files');
  expect(headers.style.getPropertyValue('--history-split')).toBe('400px');
  act(() => { mock.splitOffset = 260; mock.diff.layoutUpdated(); });
  expect(headers.style.getPropertyValue('--history-split')).toBe('260px');
  act(() => useHistoryStore.setState({ diff: { tabId: path, timestamp: 20, content: 'new content' } }));
  expect(left.querySelector('code')).toBeNull();
  await waitFor(() => expect(left.querySelector('code')).not.toBeNull());
  expect(left.querySelector('code')).not.toHaveTextContent('ba7816bf');
});

it('does not create a diff before theme initialization finishes or after the view was closed', async () => {
  let ready;
  mock.init.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'older' } });
  const view = render(<HistoryDiffView />);
  expect(mock.createDiff).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => ready());
  expect(mock.createDiff).not.toHaveBeenCalled();
});

it('discards un-applied draft edits when the comparison is closed', async () => {
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'older' } });
  render(<HistoryDiffView />);
  await waitFor(() => expect(mock.models).toHaveLength(2));
  act(() => mock.models[1].setValue('draft'));
  expect(screen.getByRole('button', { name: '应用修改' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '关闭对比' }));
  expect(getBuffer(path)).toBe('before');
  expect(historyCapture).not.toHaveBeenCalled();
  expect(useHistoryStore.getState().diff).toBeNull();
});

it.each(['before', 'a\nb\n', ''])('shows No changes for identical content %j, including normalized line endings', async (content) => {
  useEditorStore.getState().replaceTabContent(path, { content });
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: content.replace(/\n/g, '\r\n') } });
  const { container } = render(<HistoryDiffView />);
  expect(screen.getByRole('status')).toHaveTextContent('没有更改');
  expect(container.querySelector('.history-diff__editor')).not.toBeVisible();
  expect(screen.getByRole('group', { name: '现在' })).toBeVisible();
  expect(screen.getByRole('button', { name: '恢复选中差异' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '应用修改' })).toBeDisabled();
  await waitFor(() => expect(mock.models).toHaveLength(2));
});

it('keeps a fully restored draft applicable and keeps the editor alive to reveal new differences', async () => {
  useHistoryStore.setState({ diff: { tabId: path, timestamp: 10, content: 'older' } });
  const { container } = render(<HistoryDiffView />);
  await waitFor(() => expect(screen.getByRole('button', { name: '恢复选中差异' })).toBeEnabled());
  expect(screen.queryByRole('status')).toBeNull();
  expect(container.querySelector('.history-diff__editor')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '恢复选中差异' }));
  expect(screen.getByRole('status')).toHaveTextContent('没有更改');
  expect(container.querySelector('.history-diff__editor')).not.toBeVisible();
  expect(mock.diff.dispose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '应用修改' })).toBeEnabled();
  act(() => mock.models[1].setValue('another change'));
  expect(screen.queryByRole('status')).toBeNull();
  expect(container.querySelector('.history-diff__editor')).toBeVisible();
  act(() => mock.models[1].setValue('older'));
  fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
  await waitFor(() => expect(useHistoryStore.getState().diff).toBeNull());
  expect(getBuffer(path)).toBe('older');
  expect(historyCapture).toHaveBeenLastCalledWith(path, 'older', { force: true });
});
