import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  setBuffer,
  getBuffer,
  hasBuffer,
  clearBuffer,
  renameBuffer,
} from '@utils/editorBuffer';

let untitledCounter = 1;

function toTabMeta(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    name: tab.name,
    path: tab.path,
    ext: tab.ext,
    modified: !!tab.modified,
    encoding: tab.encoding || 'UTF-8',
    lineEnding: tab.lineEnding || 'LF',
    externalFileId: tab.externalFileId,
  };
}

const useEditorStore = create(
  persist(
    (set, get) => ({
      tabs: [],
      tabRenderList: [],
      activeTabId: null,
      sidebarVisible: true,
      sidebarView: 'explorer',
      viewMode: 'edit',
      toolbarVisible: false,
      cursorPosition: { lineNumber: 1, column: 1 },
      characterCount: 0,

      openFile: (file) => {
        const { tabs } = get();
        const existing = tabs.find((t) => t.path === file.path);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const newTab = {
          id: file.path,
          name: file.name,
          path: file.path,
          ext: file.name.split('.').pop() || '',
          content: file.content || '',
          encoding: file.encoding || 'UTF-8',
          lineEnding: file.lineEnding || 'LF',
          modified: false,
        };
        setBuffer(newTab.id, newTab.content);
        set({
          tabs: [...tabs, newTab],
          tabRenderList: [...get().tabRenderList, toTabMeta(newTab)],
          activeTabId: newTab.id,
        });
      },

      openExternalFile: (file) => {
        const { tabs } = get();
        const tabId = `external-${file.fileId}`;
        const existing = tabs.find((t) => t.id === tabId);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const newTab = {
          id: tabId,
          name: file.name,
          path: '',
          externalFileId: file.fileId,
          ext: (file.name || '').split('.').pop() || file.ext || '',
          content: file.content || '',
          encoding: file.encoding || 'UTF-8',
          lineEnding: file.lineEnding || 'LF',
          modified: false,
        };
        setBuffer(newTab.id, newTab.content);
        set({
          tabs: [...tabs, newTab],
          tabRenderList: [...get().tabRenderList, toTabMeta(newTab)],
          activeTabId: newTab.id,
        });
      },

      createUntitledTab: () => {
        const { tabs } = get();
        const id = `untitled-${Date.now()}`;
        const name = `Untitled-${untitledCounter++}`;
        const newTab = {
          id,
          name,
          path: '',
          ext: 'md',
          content: '',
          encoding: 'UTF-8',
          lineEnding: 'LF',
          modified: false,
        };
        setBuffer(id, '');
        set({
          tabs: [...tabs, newTab],
          tabRenderList: [...get().tabRenderList, toTabMeta(newTab)],
          activeTabId: id,
        });
      },

      renameTab: (tabId, newName) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, name: newName, ext: newName.split('.').pop() || t.ext } : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId ? { ...t, name: newName, ext: newName.split('.').pop() || t.ext } : t
          ),
        }));
      },

      updateTabPath: (tabId, path, name) => {
        renameBuffer(tabId, path);
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  id: path,
                  path,
                  name,
                  ext: name.split('.').pop() || '',
                  externalFileId: undefined,
                }
              : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  id: path,
                  path,
                  name,
                  ext: name.split('.').pop() || '',
                  externalFileId: undefined,
                }
              : t
          ),
          activeTabId: state.activeTabId === tabId ? path : state.activeTabId,
        }));
      },

      setCursorPosition: (pos) => set({ cursorPosition: pos }),
      setCharacterCount: (count) => set({ characterCount: count }),

      closeTab: (tabId) => {
        clearBuffer(tabId);
        const { tabs, activeTabId } = get();
        const filtered = tabs.filter((t) => t.id !== tabId);
        let nextActive = activeTabId;
        if (activeTabId === tabId) {
          nextActive = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
        }
        set({
          tabs: filtered,
          tabRenderList: get().tabRenderList.filter((t) => t.id !== tabId),
          activeTabId: nextActive,
        });
      },

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      /**
       * Mark a tab as dirty (or clean) without touching its content.
       * Editing flows call this once on the first keystroke after a save
       * — the actual content lives in the editor buffer until persisted.
       */
      markTabDirty: (tabId, modified = true) => {
        if (!tabId) return;
        const tab = get().tabRenderList.find((t) => t.id === tabId);
        if (!tab || tab.modified === modified) return;
        set((state) => ({
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId ? { ...t, modified } : t
          ),
        }));
      },

      /**
       * Replace stored content for a tab (e.g. on save / file watcher).
       * Caller is responsible for syncing the editor buffer.
       */
      replaceTabContent: (tabId, patch) => {
        if (patch && typeof patch.content === 'string') {
          setBuffer(tabId, patch.content);
        }
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  ...patch,
                  modified: false,
                }
              : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  ...toTabMeta({ ...t, ...patch, modified: false }),
                }
              : t
          ),
        }));
      },

      replaceTabContentByPath: (path, patch) => {
        const tab = get().tabs.find((t) => t.path === path);
        if (tab && patch && typeof patch.content === 'string') {
          setBuffer(tab.id, patch.content);
        }
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.path === path
              ? {
                  ...t,
                  ...patch,
                  modified: false,
                }
              : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.path === path
              ? {
                  ...t,
                  ...toTabMeta({ ...t, ...patch, modified: false }),
                }
              : t
          ),
        }));
      },

      markTabSaved: (tabId) => {
        if (!tabId) return;
        const content = getBuffer(tabId, undefined);
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  content: typeof content === 'string' ? content : t.content,
                  modified: false,
                }
              : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId ? { ...t, modified: false } : t
          ),
        }));
      },

      getTabContent: (tabId) => {
        if (!tabId) return '';
        if (hasBuffer(tabId)) return getBuffer(tabId, '');
        return get().tabs.find((t) => t.id === tabId)?.content || '';
      },

      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        const tab = tabs.find((t) => t.id === activeTabId) || null;
        if (!tab) return null;
        const meta = get().tabRenderList.find((t) => t.id === activeTabId);
        const buffered = hasBuffer(tab.id) ? getBuffer(tab.id, tab.content) : tab.content;
        return {
          ...tab,
          content: buffered,
          modified: meta?.modified ?? tab.modified,
        };
      },

      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarView: (view) => set({ sidebarView: view }),

      setViewMode: (mode) => set({ viewMode: mode }),
      toggleEditPreview: () =>
        set((s) => {
          if (s.viewMode === 'split') return {};
          return { viewMode: s.viewMode === 'edit' ? 'preview' : 'edit' };
        }),
      toggleSplit: () =>
        set((s) => ({
          viewMode: s.viewMode === 'split' ? 'edit' : 'split',
        })),

      toggleToolbar: () => set((s) => ({ toolbarVisible: !s.toolbarVisible })),
      setToolbarVisible: (v) => set({ toolbarVisible: v }),
    }),
    {
      name: 'mde-editor',
      partialize: (state) => ({
        sidebarVisible: state.sidebarVisible,
        sidebarView: state.sidebarView,
        viewMode: state.viewMode,
        toolbarVisible: state.toolbarVisible,
      }),
    }
  )
);

export default useEditorStore;
