import * as React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReactMarkdown from 'react-markdown';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import { markdownAnalysis } from '@/services/markdownAnalysis';
import MarkdownPreview from './MarkdownPreview';

const actions = vi.hoisted(() => ({ openFileFromPath: vi.fn() }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => actions }));
vi.mock('@/services/markdownAnalysis', () => ({ markdownAnalysis: { analyze: vi.fn() } }));
vi.mock('react-markdown', () => ({ default: vi.fn(({ children }) => React.createElement('article', null, children)) }));
vi.mock('./MarkdownCodePre', () => ({ default: () => null }));
vi.mock('./MermaidRenderer', () => ({ default: () => null }));

let finish;
const source = 'Large paragraph '.repeat(15000);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  markdownAnalysis.analyze.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  setBuffer('large', source);
  const tab = { id: 'large', path: '/large.md', name: 'large.md', content: source };
  useEditorStore.setState({ tabs: [tab], tabRenderList: [tab], activeTabId: 'large' });
});
afterEach(() => { cleanup(); clearBuffer('large'); vi.unstubAllGlobals(); });

it('parses a large preview once after analysis, and does not parse again when its menu opens', async () => {
  const { container } = render(React.createElement(MarkdownPreview));
  expect(ReactMarkdown.mock.calls.every(([props]) => props.children === '')).toBe(true);
  await act(async () => finish({ footnotes: source, outline: [] }));
  expect(ReactMarkdown.mock.calls.filter(([props]) => props.children === source)).toHaveLength(1);
  const count = ReactMarkdown.mock.calls.length;
  fireEvent.contextMenu(container.querySelector('.md-preview'), { clientX: 10, clientY: 10 });
  expect(ReactMarkdown).toHaveBeenCalledTimes(count);
  expect(markdownAnalysis.analyze).toHaveBeenCalledTimes(1);
});
