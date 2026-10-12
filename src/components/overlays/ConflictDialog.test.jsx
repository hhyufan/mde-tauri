import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import ConflictDialog from './ConflictDialog';

globalThis.React = React;
const mocks = vi.hoisted(() => ({ createDiff: vi.fn(), dispose: vi.fn(), modelDispose: vi.fn() }));
vi.mock('antd', () => ({
  Modal: ({ children }) => <div>{children}</div>,
  Button: ({ children }) => <button>{children}</button>,
  Space: ({ children }) => <div>{children}</div>,
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
    createModel: (value) => ({ getValue: () => value, dispose: mocks.modelDispose }),
    setTheme() {},
    setModelLanguage() {},
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
