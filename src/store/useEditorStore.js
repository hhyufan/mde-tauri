import { create } from 'zustand';
import { persist } from 'zustand/middleware';

let untitledCounter = 1;

const useEditorStore = create(
  persist(
    (set, get) => ({
      tabs: [],
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
        set({ tabs: [...tabs, newTab], activeTabId: newTab.id });
      },

      /**
       * Open a tab whose content was pulled from the cloud but is not yet
       * bound to any local file on this device. The first save will need
       * to go through "Save As" — see `useFileManager.saveCurrentFile`.
       */
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
        set({ tabs: [...tabs, newTab], activeTabId: newTab.id });
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
        set({ tabs: [...tabs, newTab], activeTabId: id });
      },

      renameTab: (tabId, newName) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, name: newName, ext: newName.split('.').pop() || t.ext } : t
          ),
        }));
      },

      updateTabPath: (tabId, path, name) => {
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
          activeTabId: state.activeTabId === tabId ? path : state.activeTabId,
        }));
      },

      setCursorPosition: (pos) => set({ cursorPosition: pos }),
      setCharacterCount: (count) => set({ characterCount: count }),

      closeTab: (tabId) => {
        const { tabs, activeTabId } = get();
        const filtered = tabs.filter((t) => t.id !== tabId);
        let nextActive = activeTabId;
        if (activeTabId === tabId) {
          nextActive = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
        }
        set({ tabs: filtered, activeTabId: nextActive });
      },

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      updateTabContent: (tabId, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, modified: true } : t
          ),
        }));
      },

      markTabSaved: (tabId) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, modified: false } : t
          ),
        }));
      },

      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find((t) => t.id === activeTabId) || null;
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
      // Only persist UI layout preferences, not tab content
      // (files must be re-read from disk on next open)
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
