import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { getDirectoryContents, showInExplorer } from '@utils/tauriApi';
import { splitPath, buildFullPath } from '@utils/pathUtils';
import SyncStatusIndicator from '@components/ui/SyncStatusIndicator';
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{ opacity: 0.5 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function DropdownPortal({ anchorRef, open, children, onClose }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({
        left: rect.left,
        top: rect.top,
      });
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      className="footer__dropdown-portal"
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
    >
      <div className="footer__dropdown">{children}</div>
    </div>,
    document.body
  );
}

function Footer() {
  const { t } = useTranslation();
  const { toggleSidebar, viewMode, toggleEditPreview } = useEditorStore();
  const activeTab = useEditorStore((s) => s.getActiveTab());
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const characterCount = useEditorStore((s) => s.characterCount);
  const { openFileFromPath } = useFileManager();

  const isMarkdown = activeTab ? MARKDOWN_EXT.test(activeTab.ext) : false;
  const showModeToggle = isMarkdown && viewMode !== 'split';

  const [pathSegments, setPathSegments] = useState([]);
  const [directoryContents, setDirectoryContents] = useState({});
  const [openDropdown, setOpenDropdown] = useState(null);
  const segmentRefs = useRef({});

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

  const closeDropdown = useCallback(() => setOpenDropdown(null), []);

  const setSegmentRef = useCallback((index, el) => {
    segmentRefs.current[index] = el;
  }, []);

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
            <button
              className="footer__mode-toggle"
              onClick={toggleEditPreview}
              title={viewMode === 'edit' ? t('footer.switchToPreview') : t('footer.switchToCode')}
            >
              {viewMode === 'edit' ? <EyeIcon /> : <CodeIcon />}
            </button>
          </>
        )}
      </div>

      <div className="footer__breadcrumb">
        {pathSegments.length > 0 ? (
          <div className="footer__breadcrumb-path">
            {pathSegments.map((segment, index) => (
              <span key={index} className="footer__breadcrumb-item">
                {index > 0 && <ChevronIcon />}
                <span
                  ref={(el) => setSegmentRef(index, el)}
                  className="footer__breadcrumb-segment"
                  onClick={() => handleSegmentClick(index)}
                  onContextMenu={(e) => handleContextMenu(e, index)}
                  title={buildFullPath(pathSegments, index)}
                >
                  {/^[A-Z]:\\$/i.test(segment) ? segment.substring(0, 2) : segment}
                </span>
                <DropdownPortal
                  anchorRef={{ current: segmentRefs.current[index] }}
                  open={openDropdown === index && !!directoryContents[index]}
                  onClose={closeDropdown}
                >
                  {directoryContents[index]?.length === 0 ? (
                    <div className="footer__dropdown-empty">{t('footer.emptyDir')}</div>
                  ) : (
                    directoryContents[index]?.map((item) => (
                      <div
                        key={item.path}
                        className="footer__dropdown-item"
                        onClick={() => handleFileItemClick(item)}
                      >
                        <span className="footer__dropdown-icon">
                          {item.is_dir ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          )}
                        </span>
                        <span className="footer__dropdown-name">{item.name}</span>
                      </div>
                    ))
                  )}
                </DropdownPortal>
              </span>
            ))}
          </div>
        ) : activeTab ? (
          <span>{activeTab.name}</span>
        ) : (
          <span>{t('footer.ready')}</span>
        )}
      </div>

      <div className="footer__right">
        {activeTab && (
          <>
            <span>Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}</span>
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
