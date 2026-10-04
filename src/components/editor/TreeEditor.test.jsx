import * as ReactRuntime from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, getBuffer, setBuffer } from '@utils/editorBuffer';
import TreeEditor from './TreeEditor';

globalThis.React = ReactRuntime;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));

const tabId = 'tree-editor-test';
function setup(source = 'Root\n  Child >js++\nOther\n', props = {}) {
  setBuffer(tabId, source);
  const tab = { id: tabId, name: 'test.mgtree', content: source, modified: false };
  useEditorStore.setState({ activeTabId: tabId, tabs: [tab], tabRenderList: [tab] });
  return render(<TreeEditor {...props} />);
}

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
});
afterEach(() => { cleanup(); clearBuffer(tabId); });

describe('visual tree editing', () => {
  it('expands nodes and saves edited jump syntax to the shared buffer', async () => {
    const onAutoSave = vi.fn();
    setup(undefined, { onAutoSave });
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'tree.editNode' }), { target: { value: 'Edited `code` >js[3]' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'tree.editNode' }), { key: 'Enter' });
    expect(getBuffer(tabId)).toContain('  Edited `code` >js[3]');
    expect(onAutoSave).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edited code' })).toBeInTheDocument());
    expect(useEditorStore.getState().tabs[0].modified).toBe(true);
  });

  it('cancels with Escape and does not commit IME confirmation Enter', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    const input = screen.getByRole('textbox', { name: 'tree.editNode' });
    fireEvent.change(input, { target: { value: '中文' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(getBuffer(tabId)).toContain('Root');
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getBuffer(tabId)).toContain('Root');
    expect(screen.queryByRole('textbox', { name: 'tree.editNode' })).not.toBeInTheDocument();
  });

  it('keeps the final IME candidate when the input blurs during composition', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    const input = screen.getByRole('textbox', { name: 'tree.editNode' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'zhong' } });
    fireEvent.blur(input);
    expect(getBuffer(tabId)).toContain('Root');
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '中文' } });
    await waitFor(() => expect(getBuffer(tabId)).toContain('中文\n'));
  });

  it('adds an editable first root and accepts later changes from the source pane', async () => {
    setup('');
    fireEvent.click(screen.getAllByRole('button', { name: 'tree.addRoot' })[0]);
    await screen.findByRole('textbox', { name: 'tree.editNode' });
    expect(getBuffer(tabId)).toBe('tree.newNode\n');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'tree.editNode' }), { key: 'Escape' });
    setBuffer(tabId, 'From source\n  Nested\n');
    await screen.findByRole('button', { name: 'From source' });
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    expect(screen.getByRole('button', { name: 'Nested' })).toBeInTheDocument();
  });

  it('gives only top-level rows a switcher outside every indent unit', () => {
    const { container } = setup(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    const rows = [...container.querySelectorAll('.ant-tree-treenode:not([aria-hidden])')];
    // tree-editor.scss drops the incoming vertical line for rows with no
    // `.ant-tree-indent-unit` descendant, i.e. root rows; the switcher itself
    // must stay a direct child of every row so that rule can reach it.
    const structure = rows.map((row) => [
      row.querySelectorAll('.ant-tree-indent-unit').length,
      row.querySelector(':scope > .ant-tree-switcher') !== null,
    ]);
    const labels = rows.map((row) => row.querySelector('.ant-tree-title')?.textContent);
    expect(structure).toEqual([[0, true], [1, true], [0, true]]);
    expect(labels.map((label, index) => label?.startsWith(['Root', 'Child', 'Other'][index]))).toEqual([true, true, true]);
  });

  it('routes split edits through Monaco and ignores stale row actions', () => {
    const onSourceChange = vi.fn((next) => { setBuffer(tabId, next); return true; });
    setup(undefined, { onSourceChange });
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'tree.editNode' }), { target: { value: 'Changed' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'tree.editNode' }));
    expect(onSourceChange).toHaveBeenCalledWith('Changed\n  Child >js++\nOther\n');
    setBuffer(tabId, 'New source');
    fireEvent.click(screen.getAllByRole('button', { name: 'tree.deleteNode' })[0]);
    expect(getBuffer(tabId)).toBe('New source');
  });
});
