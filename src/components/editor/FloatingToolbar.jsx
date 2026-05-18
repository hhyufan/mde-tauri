import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import { cn } from '@utils/classNames';
import './floating-toolbar.scss';

const TOOLBAR_POSITION_KEY = 'mde:floating-toolbar-position';

const HEADING_OPTIONS = [
  { label: 'H1', prefix: '# ' },
  { label: 'H2', prefix: '## ' },
  { label: 'H3', prefix: '### ' },
  { label: 'H4', prefix: '#### ' },
  { label: 'H5', prefix: '##### ' },
  { label: 'H6', prefix: '###### ' },
];

function FtBtn({ title, className, onClick, children }) {
  return (
    <Tooltip title={title} placement="top" mouseEnterDelay={0.3}>
      <button className={className} onClick={onClick} type="button">
        {children}
      </button>
    </Tooltip>
  );
}

function getToolbarBounds() {
  return document.querySelector('.editor-content__workspace')?.getBoundingClientRect() || {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
}

function clampPosition(position, rect, bounds = getToolbarBounds()) {
  if (!position || !rect || !bounds) return null;
  const margin = 8;
  const minX = bounds.left + margin;
  const minY = bounds.top + margin;
  const maxX = Math.max(minX, bounds.right - rect.width - margin);
  const maxY = Math.max(minY, bounds.bottom - rect.height - margin);
  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}

function readSavedPosition() {
  try {
    const value = JSON.parse(localStorage.getItem(TOOLBAR_POSITION_KEY) || 'null');
    if (typeof value?.x === 'number' && typeof value?.y === 'number') return value;
  } catch (_) {
    // Ignore corrupt persisted UI state.
  }
  return null;
}

function FloatingToolbar({ onInsert }) {
  const { t } = useTranslation();
  const visible = useEditorStore((s) => s.toolbarVisible);
  const toggleToolbar = useEditorStore((s) => s.toggleToolbar);
  const toolbarRef = useRef(null);
  const dragRef = useRef(null);
  const [position, setPosition] = useState(() => readSavedPosition());
  const [headingOpen, setHeadingOpen] = useState(false);

  const runAction = useCallback((action) => {
    onInsert?.(action);
    setHeadingOpen(false);
  }, [onInsert]);

  const wrap = useCallback((command, before, after) => {
    runAction({ type: 'wrap', command, before, after: after ?? before });
  }, [runAction]);

  const insertBlock = useCallback((text) => {
    runAction({ type: 'insert', text });
  }, [runAction]);

  const handleGripPointerDown = useCallback((event) => {
    if (event.button !== 0 || !toolbarRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setHeadingOpen(false);

    const rect = toolbarRef.current.getBoundingClientRect();
    const startPosition = {
      x: position?.x ?? rect.left,
      y: position?.y ?? rect.top,
    };
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: startPosition.x,
      startY: startPosition.y,
      rect,
      bounds: getToolbarBounds(),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [position]);

  const handleGripPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = clampPosition({
      x: drag.startX + event.clientX - drag.startClientX,
      y: drag.startY + event.clientY - drag.startClientY,
    }, drag.rect, drag.bounds);
    setPosition(next);
  }, []);

  const handleGripPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setPosition((current) => {
      const next = clampPosition(current, toolbarRef.current?.getBoundingClientRect());
      if (next) localStorage.setItem(TOOLBAR_POSITION_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => {
        const next = clampPosition(current, toolbarRef.current?.getBoundingClientRect());
        if (next) localStorage.setItem(TOOLBAR_POSITION_KEY, JSON.stringify(next));
        return next;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <>
      <div
        ref={toolbarRef}
        className={cn('ft', position && 'ft--custom-position', visible && 'ft--show')}
        style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
      >
        <div
          className="ft__grip"
          onPointerDown={handleGripPointerDown}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerUp}
          onPointerCancel={handleGripPointerUp}
          title={t('toolbar.drag', '拖动工具栏')}
        >
          <svg viewBox="0 0 16 24" width="10" height="16">
            <circle cx="5" cy="6" r="1.5" fill="currentColor" />
            <circle cx="11" cy="6" r="1.5" fill="currentColor" />
            <circle cx="5" cy="12" r="1.5" fill="currentColor" />
            <circle cx="11" cy="12" r="1.5" fill="currentColor" />
            <circle cx="5" cy="18" r="1.5" fill="currentColor" />
            <circle cx="11" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <span className="ft__sep" />

        <FtBtn title={t('toolbar.bold')} className="ft__btn ft__btn--active" onClick={() => wrap('bold', '**')}><b>B</b></FtBtn>
        <FtBtn title={t('toolbar.italic')} className="ft__btn" onClick={() => wrap('italic', '*')}><i>I</i></FtBtn>
        <FtBtn title={t('toolbar.strikethrough')} className="ft__btn" onClick={() => wrap('strikethrough', '~~')}><s>S</s></FtBtn>
        <span className="ft__sep" />

        <div className="ft__heading-group">
          <FtBtn title={t('toolbar.heading')} className="ft__btn" onClick={() => setHeadingOpen(!headingOpen)}><b>H</b></FtBtn>
          {headingOpen && (
            <div className="ft__heading-panel">
              {HEADING_OPTIONS.map((h) => (
                <button
                  key={h.label}
                  className="ft__heading-opt"
                  onClick={() => runAction({ type: 'insert', command: 'heading', level: Number(h.label.slice(1)), text: h.prefix })}
                >
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <FtBtn title={t('toolbar.blockquote')} className="ft__btn" onClick={() => runAction({ type: 'insert', command: 'blockquote', text: '> ' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 .001 0 1.003 1 1.003z" />
          </svg>
        </FtBtn>
        <FtBtn title={t('toolbar.table')} className="ft__btn" onClick={() => runAction({ type: 'insert', command: 'table', text: '| Col1 | Col2 | Col3 |\n| --- | --- | --- |\n| | | |\n' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </FtBtn>
        <FtBtn title={t('toolbar.code')} className="ft__btn" onClick={() => runAction({ type: 'insert', command: 'code', text: '```\n\n```\n' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
        </FtBtn>
        <span className="ft__sep" />
        <FtBtn title={t('toolbar.link')} className="ft__btn" onClick={() => wrap('link', '[', '](url)')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </FtBtn>
        <FtBtn title={t('toolbar.image')} className="ft__btn" onClick={() => runAction({ type: 'insert', command: 'image', text: '![alt](url)\n' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </FtBtn>
        <FtBtn title={t('toolbar.taskList')} className="ft__btn" onClick={() => insertBlock('- [ ] ')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </FtBtn>
        <FtBtn title={t('toolbar.rule')} className="ft__btn" onClick={() => runAction({ type: 'insert', command: 'hr', text: '---\n' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
        </FtBtn>

        <FtBtn
          title={t('toolbar.collapse')}
          className="ft__btn ft__btn--collapse"
          onClick={() => { toggleToolbar(); setHeadingOpen(false); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </FtBtn>
      </div>
    </>
  );
}

export default FloatingToolbar;
