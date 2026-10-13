import * as React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LazyMonacoEditor from './LazyMonacoEditor';

const boot = vi.hoisted(() => ({ preloadMonacoEditor: vi.fn(), getLoadedMonacoEditor: vi.fn(() => null) }));
vi.mock('@utils/monacoRuntimeBoot', () => boot);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps the editor and keyboard focus when a pending preload becomes a warm load', async () => {
  vi.stubGlobal('React', React);
  const Editor = React.forwardRef((_props, ref) => React.createElement('textarea', { ref, 'data-testid': 'editor' }));
  boot.preloadMonacoEditor.mockResolvedValue({ default: Editor });
  const result = render(React.createElement(LazyMonacoEditor));
  await act(async () => {});
  const textarea = result.getByTestId('editor');
  textarea.focus();
  boot.getLoadedMonacoEditor.mockReturnValue(Editor);
  result.rerender(React.createElement(LazyMonacoEditor, { className: 'updated' }));
  expect(result.getByTestId('editor')).toBe(textarea);
  expect(document.activeElement).toBe(textarea);
});
