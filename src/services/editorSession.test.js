import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ read: vi.fn(), watch: vi.fn(), cached: vi.fn(), auth: vi.fn() }));
vi.mock('@utils/tauriApi', () => ({ readFileContent: disk.read, startFileWatching: disk.watch,
  isSafUri: (path) => path.startsWith('content://'), historyCapture: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@store/useExternalDocsStore', () => ({ default: { getState: () => ({ get: disk.cached }) } }));
vi.mock('@store/useAuthStore', () => ({ default: { getState: () => ({ loadToken: disk.auth }) } }));

let stop;
let useEditorStore, getBuffer, getDocumentViewState, setDocumentViewState, registerDocumentViewState;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  ({ default: useEditorStore } = await import('@store/useEditorStore'));
  ({ getBuffer } = await import('@utils/editorBuffer'));
  ({ getDocumentViewState, setDocumentViewState, registerDocumentViewState } = await import('@utils/documentViewState'));
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  disk.read.mockReset();
  disk.read.mockImplementation(async (path) => ({ success: path !== '/missing.md', content: `disk:${path}` }));
  disk.watch.mockResolvedValue(true);
  disk.cached.mockReset();
  disk.auth.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); });
const save = (tabs, activeTabId, views = {}) => localStorage.setItem('mokidown-session', JSON.stringify({ version: 1, tabs, activeTabId, views }));
const tab = (path) => ({ id: path, path, name: path.slice(1), ext: 'md' });

it('restores order, current tab and view state while skipping missing files and rereading disk', async () => {
  save([tab('/a.md'), tab('/missing.md'), tab('/b.md')], '/b.md', { '/b.md': { monaco: { cursorState: ['saved'] } } });
  const session = await import('./editorSession');
  expect(session.restoreEditorSession()).toBe(session.restoreEditorSession());
  await session.restoreEditorSession();
  const state = useEditorStore.getState();
  expect(state.tabs.map((tab) => tab.id)).toEqual(['/a.md', '/b.md']);
  expect(state.tabRenderList.map((tab) => tab.id)).toEqual(['/a.md', '/b.md']);
  expect(state.activeTabId).toBe('/b.md');
  expect(getBuffer('/a.md')).toBe('disk:/a.md');
  const views = await import('@utils/documentViewState');
  expect(views.getDocumentViewState('/b.md', 'monaco')).toEqual({ cursorState: ['saved'] });
  expect(disk.read).toHaveBeenCalledTimes(3);
});

it('cannot overwrite the previous snapshot before asynchronous restoration completes', async () => {
  save([tab('/a.md')], '/a.md');
  let complete;
  disk.read.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const session = await import('./editorSession');
  const pending = session.restoreEditorSession();
  session.flushEditorSession();
  expect(JSON.parse(localStorage.getItem('mokidown-session')).tabs).toHaveLength(1);
  // A user-opened tab while IO is pending wins the final active selection.
  useEditorStore.getState().openFile({ path: '/new.md', name: 'new.md', content: 'new' });
  complete({ success: true, content: 'read' });
  await pending;
  expect(useEditorStore.getState().activeTabId).toBe('/new.md');
});

it('persists structural changes immediately and coalesces view changes without document bodies', async () => {
  const session = await import('./editorSession');
  await session.restoreEditorSession();
  const views = await import('@utils/documentViewState');
  stop = session.startEditorSessionTracking();
  useEditorStore.getState().openFile({ path: '/a.md', name: 'a.md', content: 'LARGE CONTENT'.repeat(10000) });
  let saved = JSON.parse(localStorage.getItem('mokidown-session'));
  expect(saved.tabs.map((tab) => tab.id)).toEqual(['/a.md']);
  expect(saved.tabs[0]).not.toHaveProperty('content');
  for (let i = 1; i <= 50; i++) views.setDocumentViewState('/a.md', 'preview', { top: i });
  await vi.advanceTimersByTimeAsync(700);
  saved = JSON.parse(localStorage.getItem('mokidown-session'));
  expect(saved.views['/a.md'].preview.top).toBe(50);
  useEditorStore.getState().closeTab('/a.md');
  expect(JSON.parse(localStorage.getItem('mokidown-session')).tabs).toEqual([]);
});

it('recovery replaces a clean reopened tab instead of duplicating it', () => {
  useEditorStore.getState().openFile({ path: '/a.md', name: 'a.md', content: 'disk' });
  const id = useEditorStore.getState().restoreRecoveredTab({ tabId: '/a.md', path: '/a.md', content: 'draft' });
  expect(id).toBe('/a.md');
  expect(useEditorStore.getState().tabs).toHaveLength(1);
  expect(useEditorStore.getState().getActiveTab()).toMatchObject({ content: 'draft', modified: true });
});

it('captures a mounted view before renaming its tab', () => {
  const unregister = registerDocumentViewState('preview', () => '/a.md', () => ({ top: 123 }));
  useEditorStore.getState().openFile({ path: '/a.md', name: 'a.md', content: '' });
  setDocumentViewState('/a.md', 'preview', { top: 1 });
  useEditorStore.getState().updateTabPath('/a.md', '/b.md', 'b.md');
  expect(getDocumentViewState('/b.md', 'preview')).toEqual({ top: 123 });
  unregister();
});

it('restores untitled identities and advances the name counter', async () => {
  save([{ id: 'untitled-old', name: 'Untitled-8', path: '', ext: 'md' }], 'untitled-old');
  const session = await import('./editorSession');
  await session.restoreEditorSession();
  expect(useEditorStore.getState().activeTabId).toBe('untitled-old');
  useEditorStore.getState().createUntitledTab();
  expect(useEditorStore.getState().getActiveTab().name).toBe('Untitled-9');
});

it('refreshes a legacy saved tab from disk instead of retaining its stale snapshot', async () => {
  useEditorStore.getState().openFile({ path: '/a.md', name: 'a.md', content: 'stale' });
  localStorage.setItem('mokidown-editor', JSON.stringify({ state: {
    tabs: useEditorStore.getState().tabs, activeTabId: '/a.md',
  } }));
  const session = await import('./editorSession');
  await session.restoreEditorSession();
  expect(useEditorStore.getState().getActiveTab().content).toBe('disk:/a.md');
});

it('waits for account restoration before reading an external document cache', async () => {
  save([{ id: 'external-a', name: 'a.md', path: '', externalFileId: 'a' }], 'external-a');
  let authenticated = false;
  disk.auth.mockImplementation(async () => { authenticated = true; });
  disk.cached.mockImplementation(() => authenticated ? { content: 'account cache' } : null);
  const session = await import('./editorSession');
  await session.restoreEditorSession();
  expect(useEditorStore.getState().getActiveTab().content).toBe('account cache');
});

it('preserves live edits when recovery is accepted before the dirty flag updates', async () => {
  useEditorStore.getState().openFile({ path: '/a.md', name: 'a.md', content: 'disk' });
  const { setBuffer } = await import('@utils/editorBuffer');
  setBuffer('/a.md', 'new input');
  const recoveredId = useEditorStore.getState().restoreRecoveredTab({ tabId: '/a.md', path: '/a.md', content: 'old draft' });
  expect(recoveredId).not.toBe('/a.md');
  expect(getBuffer('/a.md')).toBe('new input');
  expect(getBuffer(recoveredId)).toBe('old draft');
});
