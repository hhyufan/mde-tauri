import { afterEach, beforeEach, expect, it } from 'vitest';
import useEditorStore from './useEditorStore';
import { clearBuffer, getBuffer, setBuffer } from '@utils/editorBuffer';

beforeEach(() => {
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  for (const name of ['a', 'b', 'c']) useEditorStore.getState().openFile({ path: `/${name}.md`, name: `${name}.md`, content: name });
});
afterEach(() => { for (const name of ['a', 'b', 'c']) clearBuffer(`/${name}.md`); });
it('reorders snapshots and metadata while retaining the active document and unsaved buffers', () => {
  setBuffer('/a.md', 'unsaved A');
  const snapshots = new Map(useEditorStore.getState().tabs.map((tab) => [tab.id, tab]));
  useEditorStore.getState().reorderTabs('/a.md', '/c.md', true);
  const state = useEditorStore.getState();
  expect(state.tabs.map((tab) => tab.id)).toEqual(['/b.md', '/c.md', '/a.md']);
  expect(state.tabRenderList.map((tab) => tab.id)).toEqual(['/b.md', '/c.md', '/a.md']);
  expect(state.activeTabId).toBe('/c.md');
  expect(state.tabs.every((tab) => tab === snapshots.get(tab.id))).toBe(true);
  expect(getBuffer('/a.md')).toBe('unsaved A');
  state.reorderTabs('/a.md', '/b.md');
  expect(useEditorStore.getState().tabs.map((tab) => tab.id)).toEqual(['/a.md', '/b.md', '/c.md']);
});
it('ignores a missing drag target or dragging a tab onto itself', () => {
  const original = useEditorStore.getState().tabs;
  useEditorStore.getState().reorderTabs('/a.md', '/missing.md');
  useEditorStore.getState().reorderTabs('/a.md', '/a.md');
  expect(useEditorStore.getState().tabs).toBe(original);
});
