import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import ConflictDialog from './ConflictDialog';
import ExternalFileConflictModal from './ExternalFileConflictModal';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, setBuffer, registerEditorBufferFlusher } from '@utils/editorBuffer';

globalThis.React = React;
const mocks = vi.hoisted(() => ({ createDiff: vi.fn(), dispose: vi.fn(), modelDispose: vi.fn(), contents: [] }));
vi.mock('antd', () => ({
  Modal: ({ children }) => <div>{children}</div>,
  Button: ({ children }) => <button>{children}</button>,
  Space: ({ children }) => <div>{children}</div>,
  Alert: () => null,
  Typography: { Paragraph: ({ children }) => <p>{children}</p>, Text: ({ children }) => <span>{children}</span> },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('@/monaco-worker', () => ({}));
vi.mock('@utils/monacoShiki', () => ({
  initMonacoShiki: async () => {},
  isMonacoShikiReady: () => true,
  getMonacoThemeName: () => 'test',
}));
vi.mock('monaco-editor', () => ({
  editor: {
    createDiffEditor: (...args) => mocks.createDiff(...args),
    createModel: (value) => { mocks.contents.push(value); return { getValue: () => value, dispose: mocks.modelDispose }; },
    setTheme() {},
    setModelLanguage() {},
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.contents = [];
});

function setup() {
  const frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key) => frames.delete(key));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.createDiff.mockReturnValue({ setModel() {}, updateOptions() {}, dispose: mocks.dispose });
  return frames;
}
const props = {
  open: true,
  conflicts: [
    { fileId: 'sample', name: 'sample.md', localContent: 'local', remoteContent: 'remote' },
  ],
};

it('creates one live diff in StrictMode and disposes its models on close', async () => {
  const frames = setup();
  const view = render(
    <React.StrictMode>
      <ConflictDialog {...props} />
    </React.StrictMode>,
  );
  expect(mocks.createDiff).not.toHaveBeenCalled();
  await act(async () => {
    for (const callback of frames.values()) callback();
    frames.clear();
  });
  expect(mocks.createDiff).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
  expect(mocks.modelDispose).toHaveBeenCalledTimes(2);
});

it('cancels initialization when closed before the next frame', () => {
  const frames = setup();
  const view = render(<ConflictDialog {...props} />);
  view.unmount();
  for (const callback of frames.values()) callback();
  expect(mocks.createDiff).not.toHaveBeenCalled();
});

it('compares the flushed local buffer against the full disk file in read-only side-by-side panes', async () => {
  const frames = setup();
  const diskContent = 'disk\n'.repeat(150);
  useEditorStore.setState({ tabs: [{ id: 'conflict-test', content: 'stale snapshot' }] });
  const unregister = registerEditorBufferFlusher(() => 'conflict-test', () => setBuffer('conflict-test', 'latest local edit'));
  const view = render(<ExternalFileConflictModal conflict={{ tabId: 'conflict-test', path: 'C:/notes/file.md', diskContent }} />);
  await act(async () => { for (const callback of frames.values()) callback(); frames.clear(); });
  expect(mocks.createDiff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    readOnly: true, originalEditable: false, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false,
  }));
  expect(mocks.contents).toEqual(['latest local edit', diskContent]);
  expect(view.container).toHaveTextContent('本地编辑内容');
  expect(view.container).toHaveTextContent('磁盘内容');
  view.unmount();
  unregister();
  clearBuffer('conflict-test');
});
