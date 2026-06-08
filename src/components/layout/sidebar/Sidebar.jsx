/**
 * @file 主侧边栏模块。
 *
 * 该文件组织 Explorer、Outline、Recent 三种侧边栏视图，以及底部主题、
 * 用户和设置等全局入口，是编辑器左侧工作流的主装配层。
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Tooltip, Button, Tag } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useAuthStore from '@store/useAuthStore';
import useThemeStore from '@store/useThemeStore';
import useFileStore, { getScopedBookmarkedPaths, getScopedRecentFiles } from '@store/useFileStore';
import useNotificationStore from '@store/useNotificationStore';
import useExternalDocsStore, { getScopedExternalDocsMap } from '@store/useExternalDocsStore';
import useSyncStore from '@store/useSyncStore';
import useFileIdStore from '@store/useFileIdStore';
import { GUEST_USER_SCOPE, isOwnedByUser } from '@store/userScope';
import { fileIdFromCloudPath, syncEngine } from '@/services/syncEngine';
import { useFileManager } from '@hooks/useFileManager';
import FileTree from './explorer/FileTree';
import OutlineView from './outline/OutlineView';
import UserMenu from '@components/ui/UserMenu';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import { cn } from '@utils/classNames';
import './sidebar.scss';

/**
 * 侧边栏工具按钮。
 *
 * 统一封装浮层提示与视觉样式，减少 Explorer / Outline / Recent
 * 三组工具条里重复的按钮模板代码。
 *
 * @param {object} props 组件属性。
 * @param {string} props.title 按钮提示文案。
 * @param {Function} [props.onClick] 点击回调。
 * @param {import('react').ReactNode} props.children 按钮图标或内容。
 * @returns {JSX.Element} 统一样式的工具栏按钮。
 */
function ToolbarButton({ title, onClick, children }) {
  return (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0.3}>
      <div className="stb" onClick={onClick}>
        {children}
      </div>
    </Tooltip>
  );
}

/**
 * Explorer 排序菜单内容生成器。
 *
 * 用工厂函数而不是内联 JSX，是为了让 antd `popupRender` 在每次打开时
 * 都拿到最新排序状态，同时保持主组件结构可读。
 *
 * @param {object} options 排序菜单所需的状态与动作。
 * @returns {Function} 供 `Dropdown.popupRender` 调用的渲染函数。
 */
function renderSortDropdown({ sortBy, sortOrder, setSortBy, setSortOrder, t, close }) {
  return () => (
    <div className="sort-dropdown" onClick={(e) => e.stopPropagation()}>
      <div
        className={cn('sort-item', sortOrder === 'asc' && 'sort-item--active')}
        onClick={() => { setSortOrder('asc'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6l4 4 4-4" /><path d="M7 10V2" /><path d="M21 12H11" /><path d="M21 6H11" /><path d="M21 18H11" /></svg>
        {t('sort.ascending')}
      </div>
      <div
        className={cn('sort-item', sortOrder === 'desc' && 'sort-item--active')}
        onClick={() => { setSortOrder('desc'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 14l4 4 4-4" /><path d="M7 18V2" /><path d="M21 12H11" /><path d="M21 6H11" /><path d="M21 18H11" /></svg>
        {t('sort.descending')}
      </div>
      <div className="sort-divider" />
      <div
        className={cn('sort-item', sortBy === 'name' && 'sort-item--active')}
        onClick={() => { setSortBy('name'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg>
        {t('sort.byName')}
      </div>
      <div
        className={cn('sort-item', sortBy === 'time' && 'sort-item--active')}
        onClick={() => { setSortBy('time'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        {t('sort.byTime')}
      </div>
      <div
        className={cn('sort-item', sortBy === 'size' && 'sort-item--active')}
        onClick={() => { setSortBy('size'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></svg>
        {t('sort.bySize')}
      </div>
    </div>
  );
}

/**
 * 资源管理器工具栏：排序、新建、保存、打开目录。
 */
function ExplorerToolbar() {
  const { t } = useTranslation();
  const { sortBy, sortOrder, setSortBy, setSortOrder } = useFileStore();
  const { saveCurrentFile, openFolderDialog, createFileWithDialog } = useFileManager();

  const [sortOpen, setSortOpen] = useState(false);
  const closeSort = useCallback(() => setSortOpen(false), []);

  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.explorer.title')}</span>
      <div style={{ position: 'relative' }}>
        <Dropdown
          open={sortOpen}
          onOpenChange={setSortOpen}
          trigger={['click']}
          placement="bottomRight"
          arrow={false}
          popupRender={renderSortDropdown({ sortBy, sortOrder, setSortBy, setSortOrder, t, close: closeSort })}
        >
          <span>
            <ToolbarButton title={t('sidebar.explorer.sort')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
            </ToolbarButton>
          </span>
        </Dropdown>
      </div>
      <ToolbarButton title={t('sidebar.explorer.newFile')} onClick={createFileWithDialog}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
      </ToolbarButton>
      <ToolbarButton title={t('sidebar.explorer.save')} onClick={saveCurrentFile}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
      </ToolbarButton>
      <div className="stb-sep" />
      <ToolbarButton title={t('sidebar.explorer.openFolder')} onClick={openFolderDialog}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
      </ToolbarButton>
    </div>
  );
}

/**
 * 大纲工具栏：向 `OutlineView` 广播全局展开/折叠事件。
 */
function OutlineToolbar() {
  const { t } = useTranslation();
  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.outline.title')}</span>
      <ToolbarButton
        title={t('sidebar.outline.collapseAll')}
        onClick={() => window.dispatchEvent(new CustomEvent('outline:collapseAll'))}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      </ToolbarButton>
      <ToolbarButton
        title={t('sidebar.outline.expandAll')}
        onClick={() => window.dispatchEvent(new CustomEvent('outline:expandAll'))}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      </ToolbarButton>
    </div>
  );
}

/**
 * 最近文件工具栏：统计入口与清空列表操作。
 *
 * @param {object} props 组件属性。
 * @param {Function} props.onOpenStats 打开统计面板的回调。
 * @returns {JSX.Element} 最近文件视图工具栏。
 */
function RecentToolbar({ onOpenStats }) {
  const { t } = useTranslation();
  const { clearRecentFiles } = useFileStore();
  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.recent.title')}</span>
      <ToolbarButton title={t('sidebar.explorer.analytics')} onClick={onOpenStats}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
      </ToolbarButton>
      <div className="stb-sep" />
      <ToolbarButton title={t('sidebar.recent.deleteAll')} onClick={clearRecentFiles}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
      </ToolbarButton>
    </div>
  );
}

/**
 * 最近文件与云端书签列表。
 *
 * 这里把本地最近文件、书签优先级、云端仅在线文档三类数据聚合成同一
 * 个展示列表，保证侧边栏 recent 视图能同时覆盖本地与云同步入口。
 *
 * @param {object} props 组件属性。
 * @param {Function} props.onOpenStats 打开统计面板的回调。
 * @returns {JSX.Element} 聚合后的最近文件列表。
 */
function RecentList({ onOpenStats }) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id || GUEST_USER_SCOPE);
  const recentEntries = useFileStore((s) => s.recentFiles);
  const bookmarkEntries = useFileStore((s) => s.bookmarkedPaths);
  const externalDocEntries = useExternalDocsStore((s) => s.docs);
  const syncDocsMap = useSyncStore((s) => s.docs);
  const { openFileFromPath } = useFileManager();
  const recentFiles = useMemo(
    () => getScopedRecentFiles(recentEntries, userId),
    [recentEntries, userId],
  );
  const bookmarkedPaths = useMemo(
    () => getScopedBookmarkedPaths(bookmarkEntries, userId),
    [bookmarkEntries, userId],
  );
  const externalDocs = useMemo(
    () => getScopedExternalDocsMap(externalDocEntries, userId),
    [externalDocEntries, userId],
  );
  const syncDocs = useMemo(
    () => Object.values(syncDocsMap).filter((doc) => isOwnedByUser(doc?.ownerUserId, userId)),
    [syncDocsMap, userId],
  );

  // Recent 视图里的删除行为需要同时考虑本地最近记录、书签映射以及
  // 云端外部文档，因此统一收敛到这里处理，避免 UI 分支各自漏清理。
  /**
   * 从最近列表中移除一项，并同步处理书签或云端文档关联状态。
   *
   * @param {MouseEvent} e 删除按钮点击事件。
   * @param {object} f 待移除的最近文件或云端文档项。
   * @returns {Promise<void>}
   */
  const handleRemove = useCallback(async (e, f) => {
    e.stopPropagation();
    if (f.cloud) {
      const fileId = fileIdFromCloudPath(f.path);
      useExternalDocsStore.getState().remove(fileId);
      await syncEngine.deleteDocument(fileId);
    } else {
      useFileStore.getState().removeRecentFile(f.path);
      if (bookmarkedPaths.includes(f.path)) {
        useFileStore.getState().toggleBookmark(f.path);
        const fileId = useFileIdStore.getState().idOf(f.path);
        if (fileId) {
          await syncEngine.deleteDocument(fileId);
          useFileIdStore.getState().unbindFileId(fileId);
        }
      }
    }
  }, [bookmarkedPaths]);

  const recentPaths = new Set(recentFiles.map((r) => r.path));
  const cloudOnlyEntries = syncDocs
    .filter((doc) => !doc.deleted && !doc.localPath)
    .map((doc) => {
      const fileId = doc.fileId;
      const meta = externalDocs[fileId] || {};
      const name = doc.name || meta.name || `Cloud file (${(fileId || '').slice(0, 8)})`;
      return {
        path: `cloud://${fileId}`,
        name,
        ext: doc.ext || meta.ext || name.split('.').pop() || '',
        cloud: true,
      };
    })
    .filter((entry) => !recentPaths.has(entry.path));

  const allFiles = [...cloudOnlyEntries, ...recentFiles];
  const sortedFiles = [...allFiles].sort((a, b) => {
    const aBookmarked = bookmarkedPaths.includes(a.path);
    const bBookmarked = bookmarkedPaths.includes(b.path);
    if (aBookmarked && !bBookmarked) return -1;
    if (!aBookmarked && bBookmarked) return 1;
    return 0;
  });

  return (
    <div className="sidebar__view">
      <RecentToolbar onOpenStats={onOpenStats} />
      {sortedFiles.length === 0 ? (
        <div className="sidebar__placeholder"><p>{t('sidebar.recent.empty')}</p></div>
      ) : (
        <div className="sidebar__recent-list">
          {sortedFiles.map((f) => {
            const isBookmarked = bookmarkedPaths.includes(f.path);
            const isCloud = !!f.cloud;
            const titleText = isCloud
              ? t('sidebar.cloudFileHint', { name: f.name })
              : f.path;
            return (
              <Tooltip title={titleText} placement="right" mouseEnterDelay={0.5}>
                <div
                  key={f.path}
                  className={cn('sidebar__recent-item', isBookmarked && 'sidebar__recent-item--bookmarked')}
                  onClick={() => openFileFromPath(f.path, f.name)}
                >
                  <span className="sidebar__recent-icon">
                    <FileTypeIcon extension={f.ext} fileName={f.name} />
                    {isCloud && (
                      <Tooltip title={t('sidebar.cloud')} placement="top" mouseEnterDelay={0.3}>
                        <span className="sidebar__recent-cloud-badge">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                          </svg>
                        </span>
                      </Tooltip>
                    )}
                  </span>
                  <span className="sidebar__recent-name">{f.name}</span>
                  {isBookmarked && (
                    <Tooltip title={t('tabbar.bookmark')} placement="top" mouseEnterDelay={0.3}>
                      <span className="sidebar__recent-bookmark">
                        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title={t('sidebar.recent.remove')} placement="top" mouseEnterDelay={0.3}>
                    <span
                      className="sidebar__recent-del"
                      onClick={(e) => handleRemove(e, f)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </span>
                  </Tooltip>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 根据侧边栏页签类型返回对应图标。
 *
 * @param {object} props 组件属性。
 * @param {string} props.id 侧边栏页签标识。
 * @returns {JSX.Element} 对应页签图标。
 */
function SidebarTabIcon({ id }) {
  if (id === 'explorer') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }
  if (id === 'outline') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * 侧边栏主体。
 *
 * 承载 Explorer / Outline / Recent 三个核心工作流，同时在底部集中提供
 * 用户、主题、更新检查和设置入口。
 */
function Sidebar({ onOpenSettings, onOpenStats, onOpenLogin }) {
  const { t } = useTranslation();
  const { sidebarVisible, sidebarView, setSidebarView } = useEditorStore();
  const { theme, toggleTheme } = useThemeStore();
  const themeButtonRef = useRef(null);
  const notify = useNotificationStore.getState().notify;

  const tabs = [
    { id: 'explorer', label: t('sidebar.tab.explorer') },
    { id: 'outline', label: t('sidebar.tab.outline') },
    { id: 'recent', label: t('sidebar.tab.recent') },
  ];
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === sidebarView));

  // 主题切换优先使用 View Transition API 做径向过渡；若运行环境不支持，
  // 则自动回退为直接切换，确保旧环境不受影响。
  /**
   * 在支持时以 View Transition 动画切换主题，否则直接切换。
   *
   * @returns {void}
   */
  function handleThemeSwitch() {
    const element = themeButtonRef.current;
    if (!element) { toggleTheme(); return; }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!document.startViewTransition) { toggleTheme(); return; }
    const transition = document.startViewTransition(() => { toggleTheme(); });
    transition.ready.then(() => {
      const radius = Math.sqrt(Math.max(x, window.innerWidth - x) ** 2 + Math.max(y, window.innerHeight - y) ** 2);
      document.documentElement.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 300, pseudoElement: '::view-transition-new(root)' }
      );
    });
  }

  return (
    <aside className={cn('sidebar', !sidebarVisible && 'sidebar--hidden')}>
      <div className="sidebar__header">
        <div className="sidebar__logo">M</div>
        <h1 className="sidebar__title">{t('app.name')}</h1>
      </div>

      <div className="sidebar__tabs" role="tablist" aria-label={t('sidebar.tabs')}>
        <div
          className="sidebar__tab-slider"
          style={{
            width: `calc((100% - 10px) / ${tabs.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={sidebarView === tab.id}
            className={cn('sidebar__tab', sidebarView === tab.id && 'sidebar__tab--active')}
            onClick={() => setSidebarView(tab.id)}
          >
            <SidebarTabIcon id={tab.id} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar__content">
        {sidebarView === 'explorer' && (
          <div className="sidebar__view">
            <ExplorerToolbar />
            <FileTree />
          </div>
        )}
        {sidebarView === 'outline' && (
          <div className="sidebar__view">
            <OutlineToolbar />
            <OutlineView />
          </div>
        )}
        {sidebarView === 'recent' && (
          <RecentList onOpenStats={onOpenStats} />
        )}
      </div>

      <footer className="sidebar__footer">
        <UserMenu onOpenLogin={onOpenLogin} />
        <Tag className="sidebar__version" bordered={false}>v0.1.0</Tag>
        <Tooltip title={t('sidebar.connected')} placement="top" mouseEnterDelay={0.3}>
          <span className="sidebar__status-dot" />
        </Tooltip>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
          <Tooltip title={t('sidebar.footer.themeSwitch')} placement="top" mouseEnterDelay={0.3}>
            <Button
              ref={themeButtonRef}
              type="text"
              className="sidebar__footer-btn"
              onClick={handleThemeSwitch}
              icon={
                theme === 'dark' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                )
              }
            />
          </Tooltip>
          <Tooltip title={t('sidebar.footer.checkUpdates')} placement="top" mouseEnterDelay={0.3}>
            <Button
              type="text"
              className="sidebar__footer-btn"
              onClick={() => notify('info', t('notification.upToDate'))}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>}
            />
          </Tooltip>
          <Tooltip title={t('sidebar.footer.settings')} placement="top" mouseEnterDelay={0.3}>
            <Button
              type="text"
              className="sidebar__footer-btn"
              onClick={() => onOpenSettings?.()}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
            />
          </Tooltip>
        </div>
      </footer>
    </aside>
  );
}

export default Sidebar;
