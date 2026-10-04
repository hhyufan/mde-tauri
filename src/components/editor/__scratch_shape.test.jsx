import * as ReactRuntime from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import TreeEditor from './TreeEditor';

globalThis.React = ReactRuntime;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));

const tabId = 'tree-shape-dump';
function setup(source = 'Root\n  Child >js++\nOther\n') {
  setBuffer(tabId, source);
  const tab = { id: tabId, name: 'test.mgtree', content: source, modified: false };
  useEditorStore.setState({ activeTabId: tabId, tabs: [tab], tabRenderList: [tab] });
  return render(<TreeEditor />);
}

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
});
afterEach(() => { cleanup(); clearBuffer(tabId); });

describe('shape dump', () => {
  it('prints the row structure', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    // rc-tree also renders a hidden measurement row without a node title.
    const rows = [...container.querySelectorAll('.ant-tree-treenode')]
      .filter((row) => row.querySelector('.ant-tree-title'));
    const dump = rows.map((row) => ({
      label: row.querySelector('.ant-tree-title')?.textContent,
      indentUnits: row.querySelectorAll('.ant-tree-indent-unit').length,
      hasIndentSpan: row.querySelector('.ant-tree-indent') !== null,
      directSwitcher: row.querySelector(':scope > .ant-tree-switcher') !== null,
      switcherClass: row.querySelector(':scope > .ant-tree-switcher')?.className,
      children: [...row.children].map((c) => c.className),
    }));
    console.log('SHAPE_DUMP=' + JSON.stringify(dump, null, 1));
    expect(rows.length).toBe(3);
  });
});
