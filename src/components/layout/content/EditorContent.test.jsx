import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { openExternal } from '@utils/tauriApi';
import EditorContent from './EditorContent';

globalThis.React = React;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('@utils/tauriApi', () => ({ openExternal: vi.fn(async () => {}) }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ triggerAutoSave: vi.fn() }) }));
vi.mock('@hooks/useResponsiveLayout', () => ({ useResponsiveLayout: () => ({ isMobileLayout: false }) }));
vi.mock('@components/editor/LazyMonacoEditor', () => ({ default: React.forwardRef(({ className }, _ref) => <div data-testid="source" className={className}>source</div>) }));
vi.mock('@components/editor/MarkdownPreview', () => ({ default: React.forwardRef(({ className }, _ref) => <div className={className}><a href="https://example.com/doc">preview link</a><a href="next.md">local link</a></div>) }));
vi.mock('@components/editor/MilkdownMarkdownEditor', () => ({ default: React.forwardRef(({ className }, _ref) => <div className={className}><a href="https://example.com/doc"><span>editable link</span></a></div>) }));
vi.mock('@components/editor/FloatingToolbar', () => ({ default: () => null }));
vi.mock('@components/editor/FloatingRunButton', () => ({ default: () => null }));
vi.mock('@components/ui/Toast', () => ({ default: () => null }));
beforeEach(() => {
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null, viewMode: 'edit' });
  useConfigStore.setState({ fontSize: 14, lineHeight: 24, previewFontSize: 14, previewLineHeight: 24, previewZoomSync: true });
  vi.clearAllMocks();
});
afterEach(cleanup);
function open(name, mode = 'edit') {
  act(() => useEditorStore.setState({ activeTabId: name, tabs: [{ id: name, name }], tabRenderList: [{ id: name, name }], viewMode: mode }));
}
it('binds Ctrl+wheel after an empty workspace opens its first source file', async () => {
  render(<EditorContent />);
  open('first.js');
  const source = await screen.findByTestId('source');
  fireEvent.wheel(source, { ctrlKey: true, deltaY: -120 });
  expect(useConfigStore.getState().fontSize).toBe(15);
  fireEvent.wheel(source, { deltaY: -120 });
  expect(useConfigStore.getState().fontSize).toBe(15);
});
it('updates the visible synced font in WYSIWYG and opens nested Ctrl+click links', async () => {
  render(<EditorContent />); open('test.md', 'preview');
  const link = await screen.findByText('editable link');
  fireEvent.wheel(link, { ctrlKey: true, deltaY: -120 });
  expect(useConfigStore.getState()).toMatchObject({ fontSize: 15, previewFontSize: 15 });
  fireEvent.click(link, { ctrlKey: true });
  expect(openExternal).toHaveBeenCalledWith('https://example.com/doc');
});
it('keeps split preview zoom independent and only intercepts external modifier clicks', async () => {
  useConfigStore.setState({ previewZoomSync: false });
  render(<EditorContent />); open('test.md', 'split');
  const link = await screen.findByText('preview link');
  fireEvent.wheel(link, { ctrlKey: true, deltaY: -120 });
  expect(useConfigStore.getState()).toMatchObject({ fontSize: 14, previewFontSize: 15 });
  fireEvent.click(link, { ctrlKey: true });
  expect(openExternal).toHaveBeenCalledOnce();
  const local = screen.getByText('local link');
  local.addEventListener('click', (event) => event.preventDefault());
  fireEvent.click(local, { ctrlKey: true });
  expect(openExternal).toHaveBeenCalledOnce();
});
