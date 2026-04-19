import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useFileStore from '@store/useFileStore';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { deleteFile as deleteFileApi } from '@utils/tauriApi';
import useNotificationStore from '@store/useNotificationStore';
import { cn } from '@utils/classNames';
import './file-tree.scss';

const EXT_COLORS = {
  md: '#4091ff', txt: '#6d6d6f', json: '#ff9500', py: '#34c759',
  js: '#f7df1e', html: '#e44d26', css: '#264de4', java: '#ff3b30',
};

function FileIcon({ ext }) {
  const color = EXT_COLORS[ext] || '#6d6d6f';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="#ff9500" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="#ff9500" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

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
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const { loadDirectory, openFileFromPath, openInExplorer } = useFileManager();
  const [expandedDirs, setExpandedDirs] = useState(new Set());

  const toggleDir = useCallback((dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback((file) => {
    if (file.is_dir) {
      loadDirectory(file.path);
    } else {
      openFileFromPath(file.path, file.name);
    }
  }, [loadDirectory, openFileFromPath]);

  const goUp = useCallback(() => {
    if (!currentDir) return;
    const parentDir = getParentDir(currentDir);
    if (parentDir) loadDirectory(parentDir);
  }, [currentDir, loadDirectory]);

  const breadcrumbParts = currentDir ? currentDir.split(/[\\/]/).filter(Boolean) : [];

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

  return (
    <div className="file-tree">
      <div className="file-tree__nav">
        <button className="file-tree__nav-btn" onClick={() => useFileStore.getState().goBack()} title={t('sidebar.explorer.back')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <button className="file-tree__nav-btn" onClick={() => useFileStore.getState().goForward()} title={t('sidebar.explorer.forward')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
        </button>
        <button className="file-tree__nav-btn" onClick={goUp} title={t('sidebar.explorer.up')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
        </button>
        <div className="file-tree__nav-sep" />
        <button className="file-tree__nav-btn" onClick={() => loadDirectory(currentDir)} title={t('sidebar.explorer.refresh')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
        <button className="file-tree__nav-btn" onClick={() => openInExplorer(currentDir)} title={t('sidebar.explorer.openInExplorer')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        </button>
      </div>

      <div className="file-tree__breadcrumb">
        <svg className="file-tree__breadcrumb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
        {breadcrumbParts.length > 3 ? (
          <>
            <span className="file-tree__breadcrumb-part" onClick={() => loadDirectory(buildBreadcrumbPath(currentDir, 0))}>{breadcrumbParts[0]}</span>
            <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            <span className="file-tree__breadcrumb-part">...</span>
            <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            <span className="file-tree__breadcrumb-part">{breadcrumbParts[breadcrumbParts.length - 1]}</span>
          </>
        ) : (
          breadcrumbParts.map((part, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>}
              <span className="file-tree__breadcrumb-part" onClick={() => loadDirectory(buildBreadcrumbPath(currentDir, i))}>{part}</span>
            </span>
          ))
        )}
      </div>

      <div className="file-tree__list">
        {files.map((file) => {
          const ext = file.name.split('.').pop() || '';
          const isActive = activeTabId === file.path;
          return (
            <div
              key={file.path}
              className={cn('file-tree__item', isActive && 'file-tree__item--active')}
              onClick={() => handleFileClick(file)}
            >
              <span className="file-tree__item-icon">
                {file.is_dir ? <FolderIcon open={expandedDirs.has(file.path)} /> : <FileIcon ext={ext} />}
              </span>
              <span className="file-tree__item-name">{file.name}</span>
              {!file.is_dir && (
                <span className="file-tree__item-del" onClick={(e) => {
                  e.stopPropagation();
                  deleteFileApi(file.path).then(() => loadDirectory(currentDir)).catch((err) => useNotificationStore.getState().notify('error', 'Error', String(err)));
                }} title="Delete">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FileTree;
