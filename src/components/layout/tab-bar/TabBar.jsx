import { useRef, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import useAuthStore from '@store/useAuthStore';
import useFileStore, { getScopedBookmarkedPaths } from '@store/useFileStore';
import useNotificationStore from '@store/useNotificationStore';
import { GUEST_USER_SCOPE } from '@store/userScope';
import { renameFile } from '@utils/tauriApi';
import { useFileManager } from '@hooks/useFileManager';
import { syncEngine } from '@/services/syncEngine';
import useFileIdStore from '@store/useFileIdStore';
import { cn } from '@utils/classNames';
import './tabbar.scss';

const EXT_COLORS = {
  md: '#4091ff',
  txt: '#6d6d6f',
  json: '#ff9500',
  py: '#34c759',
  js: '#f7df1e',
  html: '#e44d26',
  css: '#264de4',
};

function TabBar() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const createUntitledTab = useEditorStore((s) => s.createUntitledTab);
  const renameTab = useEditorStore((s) => s.renameTab);
  const updateTabPath = useEditorStore((s) => s.updateTabPath);
  const viewMode = useEditorStore((s) => s.viewMode);
  const toggleSplit = useEditorStore((s) => s.toggleSplit);
  const toolbarVisible = useEditorStore((s) => s.toolbarVisible);
  const toggleToolbar = useEditorStore((s) => s.toggleToolbar);
  const sidebarVisible = useEditorStore((s) => s.sidebarVisible);
  const setSidebarView = useEditorStore((s) => s.setSidebarView);
  const toggleSidebar = useEditorStore((s) => s.toggleSidebar);
  const notify = useNotificationStore((s) => s.notify);
  const autoSave = useConfigStore((s) => s.autoSave);
  const userId = useAuthStore((s) => s.user?.id || GUEST_USER_SCOPE);
  const bookmarkEntries = useFileStore((s) => s.bookmarkedPaths);
  const toggleBookmark = useFileStore((s) => s.toggleBookmark);
  const addRecentFile = useFileStore((s) => s.addRecentFile);
  const currentDir = useFileStore((s) => s.currentDir);
  const { loadDirectory } = useFileManager();
  const scrollRef = useRef(null);

  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );

  const getTextWidth = useCallback((text) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    return ctx.measureText(text).width;
  }, []);

  const startRename = useCallback((tab, e) => {
    e.stopPropagation();
    setRenamingTabId(tab.id);
    setRenameValue(tab.name);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, []);

  const commitRename = useCallback(async (tab) => {
    const trimmed = renameValue.trim();
    setRenamingTabId(null);
    if (!trimmed || trimmed === tab.name) return;

    if (!tab.path) {
      // untitled tab — 只改显示名，保存时再由系统对话框决定真正路径
      renameTab(tab.id, trimmed);
      return;
    }

    // 真实文件 — 磁盘重命名 + 更新 store
    const sep = tab.path.includes('\\') ? '\\' : '/';
    const dir = tab.path.substring(0, tab.path.lastIndexOf(sep) + 1);
    const newPath = dir + trimmed;
    try {
      const result = await renameFile(tab.path, newPath);
      if (result?.success !== false) {
        const actualPath = result?.file_path || newPath;
        updateTabPath(tab.id, actualPath, trimmed);
        await syncEngine.rebindLocalPath(tab.path, actualPath, trimmed);
        if (currentDir) loadDirectory(currentDir);
      } else {
        notify('error', 'Rename failed', result?.message || '');
      }
    } catch (err) {
      notify('error', 'Rename failed', String(err));
    }
  }, [renameValue, renameTab, updateTabPath, notify]);

  const cancelRename = useCallback(() => {
    setRenamingTabId(null);
  }, []);

  const bookmarkedPaths = useMemo(
    () => getScopedBookmarkedPaths(bookmarkEntries, userId),
    [bookmarkEntries, userId],
  );
  const isBookmarked = activeTab?.path && bookmarkedPaths.includes(activeTab.path);

  const scrollLeft = useCallback(() => {
    scrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' });
  }, []);

  const scrollRight = useCallback(() => {
    scrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' });
  }, []);

  const handleBookmark = useCallback(async () => {
    if (!activeTab?.path) return;
    toggleBookmark(activeTab.path);
    
    if (!isBookmarked) {
      const liveTab = useEditorStore.getState().getActiveTab();
      const syncTab = liveTab?.id === activeTab.id ? liveTab : activeTab;
      await syncEngine.queueLocalUpsert(syncTab.path, syncTab.content, syncTab.encoding, {
        name: syncTab.name,
        lineEnding: syncTab.lineEnding,
        source: 'bookmark-add',
      });
      // Ensure the file is in the recent list so it appears in the sidebar
      addRecentFile({ path: syncTab.path, name: syncTab.name, ext: syncTab.ext });
      // Open sidebar and navigate to Recent tab to show the bookmarked file
      if (!sidebarVisible) toggleSidebar();
      setSidebarView('recent');
    } else {
      const fileId = useFileIdStore.getState().idOf(activeTab.path);
      if (fileId) {
        syncEngine.deleteDocument(fileId);
        useFileIdStore.getState().unbindFileId(fileId);
      }
    }
  }, [activeTab, isBookmarked, toggleBookmark, addRecentFile, sidebarVisible, toggleSidebar, setSidebarView]);

  return (
    <div className="tabbar">
      <div className="tabbar__actions tabbar__actions--left">
        <button title={t('tabbar.scrollLeft')} onClick={scrollLeft}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div className="tabbar__tabs" ref={scrollRef}>
        {tabs.map((tab) => {
          const isRenaming = renamingTabId === tab.id;
          return (
            <div
              key={tab.id}
              className={cn('tabbar__tab', activeTabId === tab.id && 'tabbar__tab--active', isRenaming && 'tabbar__tab--renaming')}
              onClick={() => !isRenaming && setActiveTab(tab.id)}
            >
              <span className="tabbar__tab-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke={EXT_COLORS[tab.ext] || '#6d6d6f'} strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  className="tabbar__tab-rename"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(tab)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(tab); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: `${Math.max(getTextWidth(renameValue) + 16, 48)}px` }}
                />
              ) : (
                <span
                  className="tabbar__tab-name"
                  onDoubleClick={(e) => startRename(tab, e)}
                >
                  {tab.name}
                </span>
              )}

              {tab.modified && !autoSave && !isRenaming && <span className="tabbar__tab-dot" />}
              {!isRenaming && (
                <span
                  className="tabbar__tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
        <button className="tabbar__new-tab" title={t('tabbar.newTab')} onClick={createUntitledTab}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <div className="tabbar__actions">
        <button title={t('tabbar.scrollRight')} onClick={scrollRight}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {/* Toolbar toggle — bottom-panel icon: filled when visible, outline when hidden */}
        <button
          className={cn('tabbar__action-btn', toolbarVisible && 'tabbar__action-btn--active')}
          title={t('tabbar.toggleToolbar')}
          onClick={toggleToolbar}
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" />
            <line x1="3" y1="15" x2="21" y2="15" />
            {toolbarVisible && <rect x="3" y="15" width="18" height="6" rx="0" fill="currentColor" stroke="none" />}
          </svg>
        </button>
        {/* Bookmark */}
        <button
          className={cn('tabbar__action-btn', isBookmarked && 'tabbar__action-btn--active')}
          title={t('tabbar.bookmark')}
          onClick={handleBookmark}
          disabled={!activeTab?.path}
        >
          <svg viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        {/* Split view */}
        <button
          className={cn('tabbar__action-btn', viewMode === 'split' && 'tabbar__action-btn--active')}
          title={t('tabbar.splitView')}
          onClick={toggleSplit}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default TabBar;
