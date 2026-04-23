import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useHorizontalDragScroll } from '@hooks/useHorizontalDragScroll';
import { useTranslation } from 'react-i18next';
import { Dropdown, Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { getDirectoryContents, showInExplorer } from '@utils/tauriApi';
import { splitPath, buildFullPath } from '@utils/pathUtils';
import SyncStatusIndicator from '@components/ui/SyncStatusIndicator';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './footer.scss';

const MARKDOWN_EXT = /^(md|markdown|mdx)$/i;

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      style={{ flexShrink: 0, color: 'var(--accent)', opacity: 0.7, transform: 'translateY(1px)' }}
    >
      <path
        d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function Footer() {
  const { t } = useTranslation();
  const { toggleSidebar, viewMode, toggleEditPreview } = useEditorStore();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const characterCount = useEditorStore((s) => s.characterCount);
  const { openFileFromPath } = useFileManager();
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );

  const isMarkdown = activeTab ? MARKDOWN_EXT.test(activeTab.ext) : false;
  const showModeToggle = isMarkdown && viewMode !== 'split';

  const [pathSegments, setPathSegments] = useState([]);
  const [directoryContents, setDirectoryContents] = useState({});
  const [openDropdown, setOpenDropdown] = useState(null);
  const bcScrollRef = useRef(null);
  const bcThumbRef = useRef(null);

  // ── Breadcrumb scroll ─────────────────────────────────────────────────────
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
    // React's synthetic onWheel is always registered as passive, so
    // preventDefault() triggers a warning. Attach a native non-passive
    // wheel listener here so vertical wheel scrolls the breadcrumb
    // horizontally without propagating to the page.
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
  }, [updateBcScrollbar, pathSegments]);

  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
      updateBcScrollbar();
    });
  }, [pathSegments, updateBcScrollbar]);

  useEffect(() => {
    if (activeTab?.path) {
      setPathSegments(splitPath(activeTab.path));
      setDirectoryContents({});
    } else {
      setPathSegments([]);
    }
  }, [activeTab?.path]);

  const handleSegmentClick = useCallback(async (index) => {
    if (openDropdown === index) {
      setOpenDropdown(null);
      return;
    }
    const dirPath = buildFullPath(pathSegments, index);
    if (!dirPath) return;
    try {
      const contents = await getDirectoryContents(dirPath);
      const sorted = [...(Array.isArray(contents) ? contents : [])].sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
      });
      setDirectoryContents((prev) => ({ ...prev, [index]: sorted }));
      setOpenDropdown(index);
    } catch (_) {
      setOpenDropdown(null);
    }
  }, [pathSegments, openDropdown]);

  const handleContextMenu = useCallback(async (e, index) => {
    e.preventDefault();
    const dirPath = buildFullPath(pathSegments, index);
    if (dirPath) {
      try {
        await showInExplorer(dirPath);
      } catch (_) { /* silent */ }
    }
  }, [pathSegments]);

  const handleFileItemClick = useCallback(async (item) => {
    setOpenDropdown(null);
    if (!item.is_dir) {
      await openFileFromPath(item.path, item.name);
    }
  }, [openFileFromPath]);

  const renderDropdown = useCallback((index) => () => {
    const items = directoryContents[index];
    return (
      <div className="footer__dropdown">
        {items?.length === 0 ? (
          <div className="footer__dropdown-empty">{t('footer.emptyDir')}</div>
        ) : (
          items?.map((item) => (
            <div
              key={item.path}
              className="footer__dropdown-item"
              onClick={() => handleFileItemClick(item)}
            >
              <span className="footer__dropdown-icon">
                {item.is_dir ? (
                  <FileTypeIcon fileName={item.name} isFolder />
                ) : (
                  <FileTypeIcon extension={item.ext} fileName={item.name} />
                )}
              </span>
              <span className="footer__dropdown-name">{item.name}</span>
            </div>
          ))
        )}
      </div>
    );
  }, [directoryContents, handleFileItemClick, t]);

  return (
    <footer className="footer">
      <div className="footer__left">
        <button className="footer__toggle-sidebar" onClick={toggleSidebar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        {showModeToggle && (
          <>
            <span className="footer__sep" />
            <Tooltip
              title={viewMode === 'edit' ? t('footer.switchToPreview') : t('footer.switchToCode')}
              placement="top"
              mouseEnterDelay={0.3}
            >
              <button
                className="footer__mode-toggle"
                onClick={toggleEditPreview}
                type="button"
              >
                {viewMode === 'edit' ? <EyeIcon /> : <CodeIcon />}
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <div className="footer__breadcrumb">
        {pathSegments.length > 0 ? (
          <>
            <div
              className="footer__breadcrumb-path"
              ref={bcScrollRef}
            >
              {pathSegments.map((segment, index) => {
                const isOpen = openDropdown === index && !!directoryContents[index];
                return (
                  <span key={index} className="footer__breadcrumb-item">
                    {index > 0 && <ChevronIcon />}
                    <Tooltip
                      title={buildFullPath(pathSegments, index)}
                      placement="top"
                      mouseEnterDelay={0.5}
                    >
                      <Dropdown
                        open={isOpen}
                        trigger={['click']}
                        placement="topLeft"
                        arrow={false}
                        popupRender={renderDropdown(index)}
                        onOpenChange={(open) => {
                          if (!open) setOpenDropdown(null);
                        }}
                      >
                      <span
                        className="footer__breadcrumb-segment"
                        onClick={() => handleSegmentClick(index)}
                        onContextMenu={(e) => handleContextMenu(e, index)}
                      >
                        {/^[A-Z]:\\$/i.test(segment) ? segment.substring(0, 2) : segment}
                      </span>
                      </Dropdown>
                    </Tooltip>
                  </span>
                );
              })}
            </div>
            <div className="footer__breadcrumb-scrollbar">
              <div
                className="footer__breadcrumb-scrollbar-thumb"
                ref={bcThumbRef}
                onMouseDown={bcOnThumbMouseDown}
              />
            </div>
          </>
        ) : activeTab ? (
          <span>{activeTab.name}</span>
        ) : (
          <span>{t('footer.ready')}</span>
        )}
      </div>

      <div className="footer__right">
        {activeTab && (
          <>
            <span>{t('footer.line')} {cursorPosition.lineNumber}, {t('footer.column')} {cursorPosition.column}</span>
            <span className="footer__sep" />
            <span>{characterCount} {t('footer.chars')}</span>
            <span className="footer__sep" />
          </>
        )}
        <span>{activeTab?.encoding || 'UTF-8'}</span>
        <span className="footer__sep" />
        <span>{activeTab?.lineEnding || 'LF'}</span>
        <span className="footer__sep" />
        <SyncStatusIndicator />
      </div>
    </footer>
  );
}

export default Footer;
