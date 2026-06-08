/**
 * ?????????????
 *
 * ???????????????????????????????????????????
 */
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

/**
 * 编辑器主 store。
 *
 * 拆分保存中的“标签持久化快照”和“用于 UI 渲染的 tab 元信息”，并把
 * 高频编辑内容外置到 `editorBuffer`，从而避免输入过程中反复触发全局渲染。
 */
/**
 * ?????? UI ?????????????
 */
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
      // 每当代码层主动替换标签内容时递增。
      // MonacoEditor 订阅这个版本号刷新 model，避免直接订阅内容对象引发
      // 过于频繁的快照比较与 React `getSnapshot` 警告。
      tabsRevision: 0,
      sidebarVisible: true,
      sidebarView: 'explorer',
      viewMode: 'edit',
      toolbarVisible: false,
      uiStateUpdatedAt: 0,
      cursorPosition: { lineNumber: 1, column: 1 },
      characterCount: 0,

      /**
       * 打开本地文件。
       *
       * `tabs` 保留持久化内容快照，`tabRenderList` 只保留渲染所需轻量元数据；
       * 真正的实时编辑内容交给 `editorBuffer` 托管。
       */
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

      /**
       * 打开只存在于云端缓存区的 external 文档。
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
        setBuffer(newTab.id, newTab.content);
        set({
          tabs: [...tabs, newTab],
          tabRenderList: [...get().tabRenderList, toTabMeta(newTab)],
          activeTabId: newTab.id,
        });
      },

      /**
       * 创建未命名标签，初始内容只落在内存缓冲中，等待首次保存拿到真实路径。
       */
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

      /** ????????????????????? */
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

      /**
       * 为标签绑定真实路径。
       *
       * 常用于未命名标签首次保存或外部云文档“认领”为本地文件后，顺带把
       * `editorBuffer` 的键也从旧 tabId 迁移到新路径。
       */
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

      /** ??????????????? */
      setCursorPosition: (pos) => set({ cursorPosition: pos }),
      /** ?????????????? */
      setCharacterCount: (count) => set({ characterCount: count }),

      /** ??????????????????????? */
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

      /** ??????????? */
      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      /**
       * 只更新标签脏状态，不直接改写内容本身。
       *
       * 编辑流程通常在“保存后第一次输入”时调用它；实时正文仍保存在
       * `editorBuffer` 中，等到持久化成功后再回写到 `tabs`。
       */
      markTabDirty: (tabId, modified = true) => {
        if (!tabId) return;
        const tab = get().tabRenderList.find((t) => t.id === tabId);
        if (!tab || tab.modified === modified) return;
        set((state) => ({
          // `syncEngine` 读取 `tabs`，UI 渲染依赖 `tabRenderList`，
          // 两处都要同步 modified，避免冲突检测读到过期脏状态。
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, modified } : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId ? { ...t, modified } : t
          ),
        }));
      },

      /**
       * 用外部内容快照替换指定标签的持久化内容。
       *
       * 常用于文件监听器回写、远端同步落盘等场景；如果 patch 中包含文本，
       * 会先同步更新 `editorBuffer`，再推进 `tabsRevision` 通知编辑器刷新。
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
          tabsRevision: state.tabsRevision + 1,
        }));
      },

      /** ?????????????????????????? */
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
          tabsRevision: state.tabsRevision + 1,
        }));
      },

      /** ????? `fileId` ????????? */
      replaceTabContentByExternalFileId: (externalFileId, patch) => {
        if (!externalFileId) return;
        const tab = get().tabs.find((t) => t.externalFileId === externalFileId);
        if (tab && patch && typeof patch.content === 'string') {
          setBuffer(tab.id, patch.content);
        }
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.externalFileId === externalFileId
              ? {
                  ...t,
                  ...patch,
                  modified: false,
                }
              : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.externalFileId === externalFileId
              ? {
                  ...t,
                  ...toTabMeta({ ...t, ...patch, modified: false }),
                }
              : t
          ),
          tabsRevision: state.tabsRevision + 1,
        }));
      },

      /**
       * 保存成功后把实时缓冲快照回写到持久化标签对象，并清除脏标记。
       */
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

      /** ???????????????????????? */
      getTabContent: (tabId) => {
        if (!tabId) return '';
        if (hasBuffer(tabId)) return getBuffer(tabId, '');
        return get().tabs.find((t) => t.id === tabId)?.content || '';
      },

      /**
       * 获取当前激活标签的“实时视图”。
       *
       * 返回值会优先合并缓冲区中的最新正文与 `tabRenderList` 中的脏状态。
       */
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

      /** ?????????????????????? */
      getTabByPath: (path) => {
        if (!path) return null;
        const tab = get().tabs.find((t) => t.path === path) || null;
        if (!tab) return null;
        const meta = get().tabRenderList.find((t) => t.id === tab.id || t.path === path);
        // 优先读取实时编辑缓冲区，避免使用落后于编辑器的持久化内容。
        const buffered = hasBuffer(tab.id) ? getBuffer(tab.id, tab.content) : tab.content;
        return {
          ...tab,
          content: buffered,
          modified: meta?.modified ?? tab.modified,
        };
      },

      /** ????? `fileId` ?????????? */
      getTabByExternalFileId: (externalFileId) => {
        if (!externalFileId) return null;
        const tab = get().tabs.find((t) => t.externalFileId === externalFileId) || null;
        if (!tab) return null;
        const meta = get().tabRenderList.find((t) => t.id === tab.id);
        const buffered = hasBuffer(tab.id) ? getBuffer(tab.id, tab.content) : tab.content;
        return {
          ...tab,
          content: buffered,
          modified: meta?.modified ?? tab.modified,
        };
      },

      /** ??????????? UI ?????? */
      toggleSidebar: () => set((s) => ({
        sidebarVisible: !s.sidebarVisible,
        uiStateUpdatedAt: Date.now(),
      })),
      /** ???????????? */
      setSidebarVisible: (visible, meta = {}) => set({
        sidebarVisible: visible,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),
      setSidebarView: (view, meta = {}) => set({
        sidebarView: view,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),

      /** ?????????? */
      setViewMode: (mode, meta = {}) => set({
        viewMode: mode,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),
      toggleEditPreview: () =>
        set((s) => {
          if (s.viewMode === 'split') return {};
          return {
            viewMode: s.viewMode === 'edit' ? 'preview' : 'edit',
            uiStateUpdatedAt: Date.now(),
          };
        }),
      /** ????????????????? */
      toggleSplit: () =>
        set((s) => ({
          viewMode: s.viewMode === 'split' ? 'edit' : 'split',
          uiStateUpdatedAt: Date.now(),
        })),

      toggleToolbar: () => set((s) => ({
        toolbarVisible: !s.toolbarVisible,
        uiStateUpdatedAt: Date.now(),
      })),
      setToolbarVisible: (v, meta = {}) => set({
        toolbarVisible: v,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),

      /**
       * 应用来自云同步的 UI 布局状态。
       *
       * 只覆盖可同步的界面字段，避免把本地运行时状态（如标签列表）误当成
       * 配置从远端整包替换。
       */
      applySyncedUiState: (uiState = {}, meta = {}) => set((state) => ({
        sidebarVisible: typeof uiState.sidebarVisible === 'boolean'
          ? uiState.sidebarVisible
          : state.sidebarVisible,
        sidebarView: uiState.sidebarView || state.sidebarView,
        viewMode: uiState.viewMode || state.viewMode,
        toolbarVisible: typeof uiState.toolbarVisible === 'boolean'
          ? uiState.toolbarVisible
          : state.toolbarVisible,
        uiStateUpdatedAt: meta.updatedAt ?? state.uiStateUpdatedAt ?? Date.now(),
      })),
    }),
    {
      name: 'mde-editor',
      partialize: (state) => ({
        sidebarVisible: state.sidebarVisible,
        sidebarView: state.sidebarView,
        viewMode: state.viewMode,
        toolbarVisible: state.toolbarVisible,
        uiStateUpdatedAt: state.uiStateUpdatedAt,
      }),
    }
  )
);

export default useEditorStore;
