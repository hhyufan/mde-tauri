// 这几个弹窗用的是模块级 i18n（不接 useTranslation），测试环境默认走英文语言表，
// 而本文件的断言写的是中文。按仓库既有做法（见 FileTree.delete / History 等）显式 mock。
vi.mock('@/i18n', () => ({
  default: {
    t: (key) =>
      ({
        'sync.conflict.removedMessage': '原文件已被删除或移动',
        'sync.conflict.changedMessage': '磁盘内容与本地编辑内容冲突',
        'sync.conflict.local': '本地编辑内容',
        'sync.conflict.remote': '磁盘内容',
        'sync.conflict.noticeRemoved': '文件已被删除或移动',
        'sync.conflict.noticeChanged': '文件在外部发生变化，自动保存已暂停',
      })[key] ?? key,
  },
}));
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
  // 把 width 透出来，测试才能断言弹窗宽度随内容切换。
  Modal: ({ children, width }) => <div data-testid="modal" data-width={width}>{children}</div>,
  Button: ({ children }) => <button>{children}</button>,
  Space: ({ children }) => <div>{children}</div>,
  Alert: ({ message, description }) => (
    <div><span>{message}</span><span>{description}</span></div>
  ),
  Typography: { Paragraph: ({ children }) => <p>{children}</p>, Text: ({ children }) => <span>{children}</span> },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化时要用它。缺了它，只要有依赖链把 @/i18n 拉进来
  // （测试 → useEditorStore → untitledFileName → @/i18n）就会整体报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
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

it('stays compact when the file was removed and there is no diff to show', () => {
  useEditorStore.setState({ tabs: [{ id: 'conflict-removed', content: 'local' }] });
  const view = render(
    <ExternalFileConflictModal conflict={{ tabId: 'conflict-removed', path: 'C:/notes/gone.md', kind: 'removed' }} />
  );
  // 没有磁盘内容就没有并排差异视图，撑到 1180px 只会空出一大片。
  expect(view.container.querySelector('.external-file-conflict__diff')).toBeNull();
  expect(view.getByTestId('modal')).toHaveAttribute('data-width', 'min(520px, 94vw)');
  expect(view.container).toHaveTextContent('原文件已被删除或移动');
  view.unmount();
  clearBuffer('conflict-removed');
});

it('goes wide only when the side-by-side diff is actually rendered', async () => {
  const frames = setup();
  useEditorStore.setState({ tabs: [{ id: 'conflict-wide', content: 'local' }] });
  const view = render(
    <ExternalFileConflictModal conflict={{ tabId: 'conflict-wide', path: 'C:/notes/file.md', diskContent: 'disk' }} />
  );
  await act(async () => { for (const callback of frames.values()) callback(); frames.clear(); });
  expect(view.container.querySelector('.external-file-conflict__diff')).not.toBeNull();
  expect(view.getByTestId('modal')).toHaveAttribute('data-width', 'min(1180px, 94vw)');
  view.unmount();
  clearBuffer('conflict-wide');
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
