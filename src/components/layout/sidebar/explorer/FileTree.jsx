/**
 * @file 资源管理器文件树模块。
 *
 * 该文件负责展示当前目录的文件树、面包屑导航与行内新建文件流程，并承接
 * Explorer 视图中的目录切换、删除与快速打开等交互。
 */
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
import { isSafUri, safDisplayName } from '@utils/tauriApi';
import './file-tree.scss';

/**
 * 根据面包屑索引重建可跳转的目录路径。
 *
 * @param {string} currentDir 当前目录绝对路径。
 * @param {number} index 目标面包屑片段索引。
 * @returns {string} 对应片段代表的目录路径。
 */
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

/**
 * 计算当前目录的父级目录路径。
 *
 * @param {string} currentDir 当前目录绝对路径。
 * @returns {string} 父级目录路径；若已到根目录则返回空字符串。
 */
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

/**
 * 资源管理器文件树。
 *
 * 负责目录导航、面包屑滚动、文件排序、新建文件入口，以及目录项点击与删除等
 * 资源管理器层交互。
 */
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

  // 面包屑横向滚动与自定义滚动条联动。
  /**
   * 按当前滚动范围更新面包屑滚动条滑块的尺寸与位置。
   *
   * @returns {void}
   */
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

  const { onThumbMouseDown: bcOnThumbMouseDown } = useHorizontalDragScroll(bcScrollRef, updateBcScrollbar);

  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateBcScrollbar, { passive: true });
    // React 合成事件里的 `onWheel` 默认是被动监听，调用 `preventDefault()`
    // 会报警告；这里改挂原生非被动监听，把纵向滚轮转成面包屑横向滚动。
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      updateBcScrollbar();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(updateBcScrollbar);
    ro.observe(el);
    updateBcScrollbar();
    return () => {
      el.removeEventListener('scroll', updateBcScrollbar);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [updateBcScrollbar, currentDir]);

  // 路径变化后自动滚到尾部，优先露出当前所在的最深层目录。
  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
      updateBcScrollbar();
    });
  }, [currentDir, updateBcScrollbar]);

  // 目录历史导航状态与能力判断。
  const currentDirIsSaf = isSafUri(currentDir);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < dirHistory.length - 1;

  /**
   * 在目录历史中后退一级，并仅刷新目标目录的文件列表。
   *
   * @returns {Promise<void>}
   */
  const handleGoBack = useCallback(async () => {
    if (!canGoBack) return;
    const targetDir = dirHistory[historyIndex - 1];
    useFileStore.getState().goBack();
    await loadFilesOnly(targetDir);
  }, [canGoBack, dirHistory, historyIndex, loadFilesOnly]);

  /**
   * 在目录历史中前进一步，并仅刷新目标目录的文件列表。
   *
   * @returns {Promise<void>}
   */
  const handleGoForward = useCallback(async () => {
    if (!canGoForward) return;
    const targetDir = dirHistory[historyIndex + 1];
    useFileStore.getState().goForward();
    await loadFilesOnly(targetDir);
  }, [canGoForward, dirHistory, historyIndex, loadFilesOnly]);

  /**
   * 打开当前目录的父级目录。
   *
   * @returns {void}
   */
  const handleGoUp = useCallback(() => {
    if (!currentDir) return;
    if (currentDirIsSaf) return;
    const parentDir = getParentDir(currentDir);
    if (parentDir) loadDirectory(parentDir);
  }, [currentDir, currentDirIsSaf, loadDirectory]);

  /**
   * 关闭当前已打开的目录，并清空资源管理器状态。
   *
   * @returns {void}
   */
  const handleCloseFolder = useCallback(() => {
    useFileStore.getState().clearDirectory();
  }, []);

  // 行内新建文件流程。
  /**
   * 启动行内新建文件流程并展示输入框。
   *
   * @returns {void}
   */
  const startCreatingFile = useCallback(() => {
    if (!currentDir) return;
    setCreatingFileName('');
    setIsCreatingFile(true);
  }, [currentDir]);

  /**
   * 取消行内新建文件流程并恢复初始状态。
   *
   * @returns {void}
   */
  const cancelCreatingFile = useCallback(() => {
    setCreatingFileName('');
    setIsCreatingFile(false);
  }, []);

  /**
   * 提交当前输入的文件名，并在创建成功后关闭输入态。
   *
   * @returns {Promise<void>}
   */
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

  // 切换目录时重置新建文件状态，并恢复面包屑折叠态。
  useEffect(() => {
    cancelCreatingFile();
    setBreadcrumbExpanded(false);
  }, [currentDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 文件与目录排序规则：目录优先，其次按用户选择字段排序。
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

  // 面包屑展示数据。
  const breadcrumbParts = currentDir
    ? (currentDirIsSaf ? [safDisplayName(currentDir)] : currentDir.split(/[\\/]/).filter(Boolean))
    : [];
  const shouldCollapse = breadcrumbParts.length > 3 && !breadcrumbExpanded;

  // 未打开目录时显示空状态占位。
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
      {/* 顶部导航栏：前进后退、刷新、系统资源管理器与关闭目录等入口。 */}
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
          currentDirIsSaf,
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

      {/* 目录面包屑：支持折叠展示、横向滚动与快速跳转。 */}
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
          >
            {shouldCollapse ? (
              /* 折叠态只保留首层、省略号与当前叶子目录。 */
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
              /* 展开态显示全部目录段，并允许横向滚动。 */
              breadcrumbParts.map((part, i) => (
                <span key={i} className="file-tree__breadcrumb-item">
                  {i > 0 && (
                    <svg className="file-tree__breadcrumb-chevron" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--accent)', opacity: 0.7 }}>
                      <path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" />
                    </svg>
                  )}
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(currentDirIsSaf ? currentDir : buildBreadcrumbPath(currentDir, i))}
                  >
                    {part}
                  </span>
                </span>
              ))
            )}
          </div>

          {/* 自定义横向滚动条，路径较长或展开时更易操作。 */}
          <div className="file-tree__breadcrumb-scrollbar">
            <div
              className="file-tree__breadcrumb-scrollbar-thumb"
              ref={bcThumbRef}
              onMouseDown={bcOnThumbMouseDown}
            />
          </div>
        </div>

        {/* 长路径展开后提供单独的折叠按钮。 */}
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

      {/* 文件列表主体。 */}
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

        {/* 行内新建文件输入行，固定追加在列表底部。 */}
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

  /**
   * 处理文件树项点击：目录进入、文件打开。
   *
   * @param {object} file 当前点击的文件树节点。
   */
  function handleFileClick(file) {
    if (file.is_dir) loadDirectory(file.path);
    else openFileFromPath(file.path, file.name);
  }
}

export default FileTree;
