/**
 * 顶部标签栏模块。
 *
 * 组织编辑器多标签切换、标签重命名、书签管理，以及 Markdown 相关工具按钮，
 * 为主编辑区提供高频文件操作入口。
 */
import { useRef, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
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
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './tabbar.scss';

/**
 * 顶部标签栏。
 *
 * 承载文件标签切换、重命名、关闭、新建、书签、工具栏开关与 Markdown
 * 分栏视图切换等高频编辑器操作。
 *
 * @returns {JSX.Element} 标签栏界面。
 */
function TabBar() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
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
  const { loadDirectory, createFileWithDialog } = useFileManager();
  const scrollRef = useRef(null);

  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );
  const isMarkdown = useMemo(
    () => /^(md|markdown|mdx)$/i.test(activeTab?.ext || ''),
    [activeTab],
  );

  /**
   * 根据当前字体设置估算标签重命名输入框所需宽度。
   *
   * @param {string} text 待测量的文本内容。
   * @returns {number} 文本渲染宽度。
   */
  const getTextWidth = useCallback((text) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    return ctx.measureText(text).width;
  }, []);

  /**
   * 进入标签重命名模式，并在下一帧自动聚焦输入框。
   *
   * @param {object} tab 待重命名的标签对象。
   * @param {MouseEvent} e 双击事件对象。
   */
  const startRename = useCallback((tab, e) => {
    e.stopPropagation();
    setRenamingTabId(tab.id);
    setRenameValue(tab.name);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, []);

  /**
   * 提交标签重命名；对已落盘文件会同步更新磁盘路径与同步映射。
   *
   * @param {object} tab 当前重命名的标签对象。
   * @returns {Promise<void>} 重命名流程结束后刷新相关状态。
   */
  const commitRename = useCallback(async (tab) => {
    const trimmed = renameValue.trim();
    setRenamingTabId(null);
    if (!trimmed || trimmed === tab.name) return;

    if (!tab.path) {
      // 未落盘标签仅修改显示名，真正保存路径交由后续系统对话框决定。
      renameTab(tab.id, trimmed);
      return;
    }

    // 已落盘文件需要同时完成磁盘重命名、编辑器状态与同步映射更新。
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
        notify('error', t('notification.renameFailed'), result?.message || '');
      }
    } catch (err) {
      notify('error', t('notification.renameFailed'), String(err));
    }
  }, [renameValue, renameTab, updateTabPath, notify, t, currentDir, loadDirectory]);

  /**
   * 退出标签重命名模式并丢弃当前输入。
   */
  const cancelRename = useCallback(() => {
    setRenamingTabId(null);
  }, []);

  const bookmarkedPaths = useMemo(
    () => getScopedBookmarkedPaths(bookmarkEntries, userId),
    [bookmarkEntries, userId],
  );
  const isBookmarked = activeTab?.path && bookmarkedPaths.includes(activeTab.path);

  /**
   * 向左平滑滚动标签列表，便于访问被遮挡的标签。
   */
  const scrollLeft = useCallback(() => {
    scrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' });
  }, []);

  /**
   * 向右平滑滚动标签列表，便于访问被遮挡的标签。
   */
  const scrollRight = useCallback(() => {
    scrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' });
  }, []);

  /**
   * 切换当前活动文件的书签状态，并同步 recent 视图与云端映射。
   *
   * @returns {Promise<void>} 书签相关副作用处理完成。
   */
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
      // 顺手补入最近文件列表，保证侧边栏 recent 视图能立刻看见。
      addRecentFile({ path: syncTab.path, name: syncTab.name, ext: syncTab.ext });
      // 自动切到侧边栏 recent 视图，直观反馈当前书签已加入列表。
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
        <Tooltip title={t('tabbar.scrollLeft')} placement="bottom" mouseEnterDelay={0.3}>
          <button onClick={scrollLeft} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div className="tabbar__tabs" ref={scrollRef}>
        {tabs.map((tab) => {
          const isRenaming = renamingTabId === tab.id;
          const isCloudTab = Boolean(
            tab.externalFileId || (typeof tab.path === 'string' && tab.path.startsWith('cloud://')),
          );
          return (
            <div
              key={tab.id}
              className={cn('tabbar__tab', activeTabId === tab.id && 'tabbar__tab--active', isRenaming && 'tabbar__tab--renaming')}
              onClick={() => !isRenaming && setActiveTab(tab.id)}
            >
              <span className="tabbar__tab-icon">
                <FileTypeIcon extension={tab.ext} fileName={tab.name} size={16} />
                {isCloudTab && (
                  <Tooltip title={t('sidebar.cloud')} placement="top" mouseEnterDelay={0.3}>
                    <span className="tabbar__tab-cloud-badge">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                      </svg>
                    </span>
                  </Tooltip>
                )}
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
        <Tooltip title={t('tabbar.newTab')} placement="bottom" mouseEnterDelay={0.3}>
          <button className="tabbar__new-tab" onClick={createFileWithDialog} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div className="tabbar__actions">
        <Tooltip title={t('tabbar.scrollRight')} placement="bottom" mouseEnterDelay={0.3}>
          <button onClick={scrollRight} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </Tooltip>
        {/* Markdown 文件专属工具栏开关。 */}
        {isMarkdown && (
          <Tooltip title={t('tabbar.toggleToolbar')} placement="bottom" mouseEnterDelay={0.3}>
            <button
              className={cn('tabbar__action-btn', toolbarVisible && 'tabbar__action-btn--active')}
              onClick={toggleToolbar}
              type="button"
            >
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" fill="none" />
                <line x1="3" y1="15" x2="21" y2="15" />
                {toolbarVisible && <rect x="3" y="15" width="18" height="6" rx="0" fill="currentColor" stroke="none" />}
              </svg>
            </button>
          </Tooltip>
        )}
        {/* 当前文件书签开关。 */}
        <Tooltip title={t('tabbar.bookmark')} placement="bottom" mouseEnterDelay={0.3}>
          <button
            className={cn('tabbar__action-btn', isBookmarked && 'tabbar__action-btn--active')}
            onClick={handleBookmark}
            disabled={!activeTab?.path}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </Tooltip>
        {/* Markdown 文件专属分栏视图开关。 */}
        {isMarkdown && (
          <Tooltip title={t('tabbar.splitView')} placement="bottom" mouseEnterDelay={0.3}>
            <button
              className={cn('tabbar__action-btn', viewMode === 'split' && 'tabbar__action-btn--active')}
              onClick={toggleSplit}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default TabBar;
