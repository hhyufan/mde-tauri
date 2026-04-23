import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useFileStore from '@store/useFileStore';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { useHorizontalDragScroll } from '@hooks/useHorizontalDragScroll';
import { deleteFile as deleteFileApi } from '@utils/tauriApi';
import useNotificationStore from '@store/useNotificationStore';
import { cn } from '@utils/classNames';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './file-tree.scss';

function buildBreadcrumbPath(currentDir, index) {
  if (!currentDir) return '';
  const normalized = currentDir.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return '';

  const isWindowsDrive = /^[A-Z]:$/i.test(parts[0]);
  if (isWindowsDrive) {
    if (index <= 0) return `${parts[0]}\\`;
    return `${parts[0]}\\${parts.slice(1, index + 1).join('\\')}`;
  }
  return `/${parts.slice(0, index + 1).join('/')}`;
}

function getParentDir(currentDir) {
  if (!currentDir) return '';
  const normalized = currentDir.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return '';

  const isWindowsDrive = /^[A-Z]:$/i.test(parts[0]);
  if (isWindowsDrive) {
    if (parts.length === 2) return `${parts[0]}\\`;
    return `${parts[0]}\\${parts.slice(1, -1).join('\\')}`;
  }
  const next = `/${parts.slice(0, -1).join('/')}`;
  return next || '/';
}

function FileTree() {
  const { t } = useTranslation();
  const files = useFileStore((s) => s.files);
  const currentDir = useFileStore((s) => s.currentDir);
  const historyIndex = useFileStore((s) => s.historyIndex);
  const dirHistory = useFileStore((s) => s.dirHistory);
  const sortBy = useFileStore((s) => s.sortBy);
  const sortOrder = useFileStore((s) => s.sortOrder);
  const activeTabId = useEditorStore((s) => s.activeTabId);

  const {
    loadDirectory,
    loadFilesOnly,
    openFileFromPath,
    openInExplorer,
    createFileInCurrentDir,
  } = useFileManager();

  const [creatingFileName, setCreatingFileName] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [breadcrumbExpanded, setBreadcrumbExpanded] = useState(false);
  const createInputRef = useRef(null);
  const bcScrollRef = useRef(null);
  const bcThumbRef = useRef(null);

  // ── Breadcrumb scroll helpers ─────────────────────────────────────────────
  const updateBcScrollbar = useCallback(() => {
    const el = bcScrollRef.current;
    const thumb = bcThumbRef.current;
    if (!el || !thumb) return;
    const ratio = el.clientWidth / el.scrollWidth;
    if (ratio >= 1) {
      thumb.style.display = 'none';
    } else {
      thumb.style.display = 'block';
      thumb.style.width = `${ratio * 100}%`;
      thumb.style.left = `${(el.scrollLeft / el.scrollWidth) * 100}%`;
    }
  }, []);

  const handleBcWheel = useCallback((e) => {
    const el = bcScrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // let native horizontal scroll pass
    e.preventDefault();
    el.scrollLeft += e.deltaY;
    updateBcScrollbar();
  }, [updateBcScrollbar]);

  const { onThumbMouseDown: bcOnThumbMouseDown } = useHorizontalDragScroll(bcScrollRef, updateBcScrollbar);

  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateBcScrollbar, { passive: true });
    const ro = new ResizeObserver(updateBcScrollbar);
    ro.observe(el);
    updateBcScrollbar();
    return () => {
      el.removeEventListener('scroll', updateBcScrollbar);
      ro.disconnect();
    };
  }, [updateBcScrollbar, currentDir]);

  // Scroll to end when path changes so the leaf folder is visible
  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
      updateBcScrollbar();
    });
  }, [currentDir, updateBcScrollbar]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < dirHistory.length - 1;

  const handleGoBack = useCallback(async () => {
    if (!canGoBack) return;
    const targetDir = dirHistory[historyIndex - 1];
    useFileStore.getState().goBack();
    await loadFilesOnly(targetDir);
  }, [canGoBack, dirHistory, historyIndex, loadFilesOnly]);

  const handleGoForward = useCallback(async () => {
    if (!canGoForward) return;
    const targetDir = dirHistory[historyIndex + 1];
    useFileStore.getState().goForward();
    await loadFilesOnly(targetDir);
  }, [canGoForward, dirHistory, historyIndex, loadFilesOnly]);

  const handleGoUp = useCallback(() => {
    if (!currentDir) return;
    const parentDir = getParentDir(currentDir);
    if (parentDir) loadDirectory(parentDir);
  }, [currentDir, loadDirectory]);

  const handleCloseFolder = useCallback(() => {
    useFileStore.getState().clearDirectory();
  }, []);

  // ── File creation ─────────────────────────────────────────────────────────
  const startCreatingFile = useCallback(() => {
    if (!currentDir) return;
    setCreatingFileName('');
    setIsCreatingFile(true);
  }, [currentDir]);

  const cancelCreatingFile = useCallback(() => {
    setCreatingFileName('');
    setIsCreatingFile(false);
  }, []);

  const commitCreatingFile = useCallback(async () => {
    if (!creatingFileName.trim()) {
      cancelCreatingFile();
      return;
    }
    const result = await createFileInCurrentDir(creatingFileName);
    if (result?.ok) cancelCreatingFile();
  }, [cancelCreatingFile, createFileInCurrentDir, creatingFileName]);

  useEffect(() => {
    if (!isCreatingFile) return;
    requestAnimationFrame(() => {
      createInputRef.current?.focus();
      createInputRef.current?.select();
    });
  }, [isCreatingFile]);

  useEffect(() => {
    const handler = () => startCreatingFile();
    window.addEventListener('explorer:newFileRequest', handler);
    return () => window.removeEventListener('explorer:newFileRequest', handler);
  }, [startCreatingFile]);

  // Cancel creation & collapse breadcrumb when directory changes
  useEffect(() => {
    cancelCreatingFile();
    setBreadcrumbExpanded(false);
  }, [currentDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sorting ───────────────────────────────────────────────────────────────
  const sortedFiles = useMemo(() => {
    const direction = sortOrder === 'desc' ? -1 : 1;
    return [...files].sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      let cmp = 0;
      if (sortBy === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (sortBy === 'time') cmp = (a.modified || 0) - (b.modified || 0);
      else cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return cmp * direction;
    });
  }, [files, sortBy, sortOrder]);

  // ── Breadcrumb ────────────────────────────────────────────────────────────
  const breadcrumbParts = currentDir ? currentDir.split(/[\\/]/).filter(Boolean) : [];
  const shouldCollapse = breadcrumbParts.length > 3 && !breadcrumbExpanded;

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!currentDir) {
    return (
      <div className="file-tree__empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 32, height: 32, opacity: 0.3 }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <p>{t('sidebar.explorer.openFolder')}</p>
      </div>
    );
  }

  const navBtn = (title, className, onClick, disabled, icon) => (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0.3}>
      <button
        className={className}
        onClick={onClick}
        disabled={disabled}
        type="button"
      >
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div className="file-tree">
      {/* Navigation bar */}
      <div className="file-tree__nav">
        {navBtn(
          t('sidebar.explorer.back'),
          cn('file-tree__nav-btn', !canGoBack && 'file-tree__nav-btn--disabled'),
          handleGoBack,
          !canGoBack,
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>,
        )}
        {navBtn(
          t('sidebar.explorer.forward'),
          cn('file-tree__nav-btn', !canGoForward && 'file-tree__nav-btn--disabled'),
          handleGoForward,
          !canGoForward,
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>,
        )}
        {navBtn(
          t('sidebar.explorer.up'),
          'file-tree__nav-btn',
          handleGoUp,
          false,
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </svg>,
        )}
        <div className="file-tree__nav-sep" />
        {navBtn(
          t('sidebar.explorer.refresh'),
          'file-tree__nav-btn',
          () => loadDirectory(currentDir),
          false,
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>,
        )}
        {navBtn(
          t('sidebar.explorer.openInExplorer'),
          'file-tree__nav-btn',
          () => openInExplorer(currentDir),
          false,
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>,
        )}
        <div className="file-tree__nav-sep" />
        {navBtn(
          t('sidebar.explorer.closeFolder'),
          'file-tree__nav-btn file-tree__nav-btn--close',
          handleCloseFolder,
          false,
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>,
        )}
      </div>

      {/* Breadcrumb */}
      <div className="file-tree__breadcrumb">
        <svg
          className="file-tree__breadcrumb-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>

        <div className="file-tree__breadcrumb-scroll-wrap">
          <div
            className="file-tree__breadcrumb-scroll"
            ref={bcScrollRef}
            onWheel={handleBcWheel}
          >
            {shouldCollapse ? (
              /* Collapsed: first > ... > last */
              <>
                <span className="file-tree__breadcrumb-item">
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(buildBreadcrumbPath(currentDir, 0))}
                  >
                    {breadcrumbParts[0]}
                  </span>
                </span>
                <span className="file-tree__breadcrumb-item">
                  <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--accent)', opacity: 0.7 }}>
                    <path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" />
                  </svg>
                  <Tooltip title={t('sidebar.explorer.expandBreadcrumb')} placement="bottom" mouseEnterDelay={0.3}>
                    <span
                      className="file-tree__breadcrumb-ellipsis"
                      onClick={() => setBreadcrumbExpanded(true)}
                    >
                      …
                    </span>
                  </Tooltip>
                </span>
                <span className="file-tree__breadcrumb-item">
                  <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--accent)', opacity: 0.7 }}>
                    <path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" />
                  </svg>
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(currentDir)}
                  >
                    {breadcrumbParts[breadcrumbParts.length - 1]}
                  </span>
                </span>
              </>
            ) : (
              /* Expanded: all parts, scrollable */
              breadcrumbParts.map((part, i) => (
                <span key={i} className="file-tree__breadcrumb-item">
                  {i > 0 && (
                    <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--accent)', opacity: 0.7 }}>
                      <path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" />
                    </svg>
                  )}
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(buildBreadcrumbPath(currentDir, i))}
                  >
                    {part}
                  </span>
                </span>
              ))
            )}
          </div>

          {/* Custom horizontal scrollbar — only useful when expanded */}
          <div className="file-tree__breadcrumb-scrollbar">
            <div
              className="file-tree__breadcrumb-scrollbar-thumb"
              ref={bcThumbRef}
              onMouseDown={bcOnThumbMouseDown}
            />
          </div>
        </div>

        {/* Collapse button — shown when expanded and path was long */}
        {breadcrumbParts.length > 3 && breadcrumbExpanded && (
          <Tooltip title={t('sidebar.explorer.collapseBreadcrumb')} placement="bottom" mouseEnterDelay={0.3}>
            <button
              className="file-tree__breadcrumb-collapse"
              onClick={() => setBreadcrumbExpanded(false)}
              type="button"
            >
              <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="10" height="10" style={{ transform: 'rotate(-90deg)', color: 'var(--accent)', opacity: 0.7 }}>
                <path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>

      {/* File list */}
      <div className="file-tree__list">
        {sortedFiles.map((file) => {
          const ext = file.name.split('.').pop() || '';
          const isActive = activeTabId === file.path;
          return (
            <div
              key={file.path}
              className={cn('file-tree__item', isActive && 'file-tree__item--active')}
              onClick={() => handleFileClick(file)}
            >
              <span className="file-tree__item-icon">
                {file.is_dir
                  ? <FileTypeIcon fileName={file.name} isFolder />
                  : <FileTypeIcon extension={ext} fileName={file.name} />}
              </span>
              <span className="file-tree__item-name">{file.name}</span>
              {!file.is_dir && (
                <Tooltip title={t('sidebar.explorer.deleteFile')} placement="top" mouseEnterDelay={0.3}>
                <span
                  className="file-tree__item-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFileApi(file.path)
                      .then(() => loadDirectory(currentDir))
                      .catch((err) =>
                        useNotificationStore.getState().notify('error', t('notification.error'), String(err))
                      );
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </span>
                </Tooltip>
              )}
            </div>
          );
        })}

        {/* Inline new-file row — always at the bottom */}
        {isCreatingFile && (
          <div className="file-tree__item file-tree__item--creating">
            <span className="file-tree__item-icon">
              <FileTypeIcon extension="md" fileName={creatingFileName || 'untitled.md'} />
            </span>
            <input
              ref={createInputRef}
              className="file-tree__item-input"
              value={creatingFileName}
              onChange={(e) => setCreatingFileName(e.target.value)}
              onBlur={commitCreatingFile}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); commitCreatingFile(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelCreatingFile(); }
              }}
              placeholder={t('sidebar.explorer.newFilePlaceholder')}
            />
          </div>
        )}
      </div>
    </div>
  );

  function handleFileClick(file) {
    if (file.is_dir) loadDirectory(file.path);
    else openFileFromPath(file.path, file.name);
  }
}

export default FileTree;
