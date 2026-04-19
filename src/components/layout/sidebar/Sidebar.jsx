import { useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import useFileStore from '@store/useFileStore';
import useNotificationStore from '@store/useNotificationStore';
import useExternalDocsStore from '@store/useExternalDocsStore';
import useSyncStore from '@store/useSyncStore';
import { fileIdFromCloudPath, syncEngine } from '@/services/syncEngine';
import { useFileManager } from '@hooks/useFileManager';
import FileTree from './explorer/FileTree';
import OutlineView from './outline/OutlineView';
import UserMenu from '@components/ui/UserMenu';
import { cn } from '@utils/classNames';
import './sidebar.scss';

function ToolbarButton({ title, onClick, children }) {
  return (
    <div className="stb" title={title} onClick={onClick}>
      {children}
    </div>
  );
}

function SortDropdown({ open, onClose }) {
  const { t } = useTranslation();
  const { sortBy, sortOrder, setSortBy, setSortOrder } = useFileStore();
  if (!open) return null;
  return (
    <div className="sort-dropdown" onClick={(e) => e.stopPropagation()} onMouseLeave={onClose}>
      <div className={cn('sort-item', sortOrder === 'asc' && 'sort-item--active')} onClick={() => { setSortOrder('asc'); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6l4 4 4-4" /><path d="M7 10V2" /><path d="M21 12H11" /><path d="M21 6H11" /><path d="M21 18H11" /></svg>
        {t('sort.ascending')}
      </div>
      <div className={cn('sort-item', sortOrder === 'desc' && 'sort-item--active')} onClick={() => { setSortOrder('desc'); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 14l4 4 4-4" /><path d="M7 18V2" /><path d="M21 12H11" /><path d="M21 6H11" /><path d="M21 18H11" /></svg>
        {t('sort.descending')}
      </div>
      <div className="sort-divider" />
      <div className={cn('sort-item', sortBy === 'name' && 'sort-item--active')} onClick={() => { setSortBy('name'); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg>
        {t('sort.byName')}
      </div>
      <div className={cn('sort-item', sortBy === 'time' && 'sort-item--active')} onClick={() => { setSortBy('time'); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        {t('sort.byTime')}
      </div>
      <div className={cn('sort-item', sortBy === 'size' && 'sort-item--active')} onClick={() => { setSortBy('size'); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></svg>
        {t('sort.bySize')}
      </div>
    </div>
  );
}

function ExplorerToolbar() {
  const { t } = useTranslation();
  const [sortOpen, setSortOpen] = useState(false);
  const { saveCurrentFile, openFolderDialog, createNewFile } = useFileManager();

  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.explorer.title')}</span>
      <div style={{ position: 'relative' }}>
        <ToolbarButton title={t('sidebar.explorer.sort')} onClick={() => setSortOpen(!sortOpen)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
        </ToolbarButton>
        <SortDropdown open={sortOpen} onClose={() => setSortOpen(false)} />
      </div>
      <ToolbarButton title={t('sidebar.explorer.newFile')} onClick={createNewFile}>
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

function OutlineToolbar() {
  const { t } = useTranslation();
  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.outline.title')}</span>
      <ToolbarButton title={t('sidebar.outline.collapseAll')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      </ToolbarButton>
      <ToolbarButton title={t('sidebar.outline.expandAll')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      </ToolbarButton>
    </div>
  );
}

function RecentToolbar({ onOpenStats }) {
  const { t } = useTranslation();
  const { clearRecentFiles } = useFileStore();
  return (
    <>
      <div className="sidebar__toolbar">
        <span className="sidebar__toolbar-label">{t('sidebar.recent.title')}</span>
        <ToolbarButton title={t('sidebar.explorer.sort')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
        </ToolbarButton>
        <ToolbarButton title={t('sidebar.explorer.newFile')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </ToolbarButton>
        <ToolbarButton title={t('sidebar.explorer.save')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
        </ToolbarButton>
        <div className="stb-sep" />
        <ToolbarButton title={t('sidebar.explorer.analytics')} onClick={onOpenStats}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
        </ToolbarButton>
      </div>
      <div className="sidebar__toolbar sidebar__toolbar--secondary">
        <ToolbarButton title="List view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
        </ToolbarButton>
        <ToolbarButton title="Refresh">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </ToolbarButton>
        <ToolbarButton title="Copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        </ToolbarButton>
        <div className="stb-sep" />
        <ToolbarButton title={t('sidebar.recent.deleteAll')} onClick={clearRecentFiles}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </ToolbarButton>
      </div>
    </>
  );
}

const EXT_COLORS = { md: '#4091ff', txt: '#6d6d6f', json: '#ff9500', py: '#34c759', js: '#f7df1e', html: '#e44d26', css: '#264de4' };

function RecentList({ onOpenStats }) {
  const { t } = useTranslation();
  const recentFiles = useFileStore((s) => s.recentFiles);
  const bookmarkedPaths = useFileStore((s) => s.bookmarkedPaths);
  const externalDocs = useExternalDocsStore((s) => s.docs);
  const syncDocsMap = useSyncStore((s) => s.docs);
  const { openFileFromPath } = useFileManager();
  const syncDocs = useMemo(() => Object.values(syncDocsMap), [syncDocsMap]);

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
            const ext = f.ext || f.name?.split('.').pop() || '';
            const color = EXT_COLORS[ext] || '#6d6d6f';
            const isBookmarked = bookmarkedPaths.includes(f.path);
            const isCloud = !!f.cloud;
            const titleText = isCloud
              ? `${f.name} (cloud — Save As on first save)`
              : f.path;
            return (
              <div key={f.path} className={cn('sidebar__recent-item', isBookmarked && 'sidebar__recent-item--bookmarked')} onClick={() => openFileFromPath(f.path, f.name)} title={titleText}>
                <span className="sidebar__recent-icon" style={{ background: `${color}18`, color }}>
                  {isCloud ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  )}
                </span>
                <span className="sidebar__recent-name">{f.name}</span>
                {isBookmarked && (
                  <span className="sidebar__recent-bookmark" title={t('tabbar.bookmark')}>
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                  </span>
                )}
                <span className="sidebar__recent-del" onClick={(e) => handleRemove(e, f)} title={t('sidebar.recent.remove')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const activeIndex = tabs.findIndex((tab) => tab.id === sidebarView);

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

      <div className="sidebar__tabs">
        <div className="sidebar__tab-slider" style={{ left: `${(activeIndex / tabs.length) * 100}%`, width: `${100 / tabs.length}%` }} />
        {tabs.map((tab) => (
          <div key={tab.id} className={cn('sidebar__tab', sidebarView === tab.id && 'sidebar__tab--active')} onClick={() => setSidebarView(tab.id)}>
            {tab.label}
          </div>
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
        <span className="sidebar__version">v0.1.0</span>
        <span className="sidebar__status-dot" title="Connected" />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
          <button
            ref={themeButtonRef}
            className="sidebar__footer-btn"
            onClick={handleThemeSwitch}
            title={t('sidebar.footer.themeSwitch')}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
          </button>
          <button className="sidebar__footer-btn" onClick={() => notify('info', t('notification.upToDate'))} title={t('sidebar.footer.checkUpdates')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
          <button className="sidebar__footer-btn" onClick={() => onOpenSettings?.()} title={t('sidebar.footer.settings')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
      </footer>
    </aside>
  );
}

export default Sidebar;
