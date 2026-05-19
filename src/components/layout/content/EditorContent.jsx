import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import MonacoEditor from '@components/editor/LazyMonacoEditor';
import FloatingToolbar from '@components/editor/FloatingToolbar';
import ToastContainer from '@components/ui/Toast';
import { useFileManager } from '@hooks/useFileManager';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import './editor-content.scss';

// Markdown renderers stay on lazy boundaries so non-markdown files still load
// the lightweight Monaco path. Preview mode is editable WYSIWYG; split preview
// is a read-only renderer.
const MilkdownMarkdownEditor = lazy(() => import('@components/editor/MilkdownMarkdownEditor'));
const MarkdownPreview = lazy(() => import('@components/editor/MarkdownPreview'));

const PreviewFallback = () => (
  <div style={{ flex: 1, minHeight: 0 }} />
);

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 24;
// Trackpad pinch is reported as wheel events with small deltaY values; accumulate
// them so the font size doesn't jump on every micro-tick. Regular mouse wheel ticks
// (deltaY ~= 100) still trigger a change immediately.
const WHEEL_ZOOM_THRESHOLD = 24;
const WHEEL_ZOOM_RESET_MS = 250;

function clampFontSize(value) {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
}

function computeTypographyForSize(targetFontSize) {
  const { fontSize, lineHeight } = useConfigStore.getState();
  const currentFontSize = fontSize || DEFAULT_FONT_SIZE;
  const currentLineHeight = lineHeight || DEFAULT_LINE_HEIGHT;
  const lineHeightRatio = currentLineHeight / currentFontSize;
  const nextFontSize = clampFontSize(targetFontSize);

  return {
    fontSize: nextFontSize,
    lineHeight: Math.round(nextFontSize * lineHeightRatio),
  };
}

function getNextTypography(delta) {
  const { fontSize } = useConfigStore.getState();
  const currentFontSize = fontSize || DEFAULT_FONT_SIZE;
  return computeTypographyForSize(currentFontSize + delta);
}

function EditorContent() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const viewMode = useEditorStore((s) => s.viewMode);
  const monacoRef = useRef(null);
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const setConfig = useConfigStore((s) => s.setConfig);
  const { triggerAutoSave } = useFileManager();
  const { isMobileLayout } = useResponsiveLayout();
  const activeTabMeta = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );

  const handleToolbarInsert = useCallback((action) => {
    const editor = monacoRef.current;
    if (!editor) return;

    if (typeof editor.handleToolbarAction === 'function' && editor.handleToolbarAction(action)) {
      return;
    }

    if (action.type === 'insert') {
      editor.insertText(action.text);
    } else if (action.type === 'wrap') {
      editor.wrapSelection(action.before, action.after);
    }
  }, []);

  // The split-pane divider uses Pointer Events so the same code path drives
  // mouse drags on desktop and touch drags on Android. setPointerCapture is
  // critical on touch: without it Android Chrome stops sending pointermove
  // events as soon as the finger leaves the divider's hit area.
  //
  // In mobile column layout the workspace stacks editor/preview vertically,
  // so we measure clientY/height instead of clientX/width.
  const handleDividerPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const dividerEl = e.currentTarget;
    const vertical = isMobileLayout; // column layout when true → drag vertically
    isDragging.current = true;
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    try {
      dividerEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // setPointerCapture can throw on detached nodes; the move handler
      // still works without capture, the touch path just becomes a bit
      // flakier when the finger leaves the original target.
    }

    const onPointerMove = (moveEvt) => {
      if (!isDragging.current || !containerRef.current) return;
      if (moveEvt.pointerId !== e.pointerId) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = vertical
        ? (moveEvt.clientY - rect.top) / rect.height
        : (moveEvt.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(0.15, Math.min(0.85, ratio)));
    };

    const stop = (endEvt) => {
      if (endEvt && endEvt.pointerId !== e.pointerId) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        dividerEl.releasePointerCapture(e.pointerId);
      } catch (_) {
        // Already released by the browser on pointerup; safe to ignore.
      }
      dividerEl.removeEventListener('pointermove', onPointerMove);
      dividerEl.removeEventListener('pointerup', stop);
      dividerEl.removeEventListener('pointercancel', stop);
    };

    dividerEl.addEventListener('pointermove', onPointerMove);
    dividerEl.addEventListener('pointerup', stop);
    dividerEl.addEventListener('pointercancel', stop);
  }, [isMobileLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const applyTypography = (typography) => {
      setConfig('fontSize', typography.fontSize);
      setConfig('lineHeight', typography.lineHeight);
    };

    // --- Wheel (mouse + trackpad pinch) --------------------------------------
    // Browsers translate trackpad pinch into wheel events with ctrlKey=true and
    // very small deltaY values. We accumulate them and only step the font size
    // once the accumulated delta crosses a threshold, otherwise pinching feels
    // jittery and overshoots wildly.
    let wheelAccumulator = 0;
    let wheelResetTimer = null;

    const handleWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;

      event.preventDefault();
      event.stopPropagation();

      wheelAccumulator += event.deltaY;
      if (wheelResetTimer) clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(() => {
        wheelAccumulator = 0;
        wheelResetTimer = null;
      }, WHEEL_ZOOM_RESET_MS);

      if (Math.abs(wheelAccumulator) < WHEEL_ZOOM_THRESHOLD) return;

      const step = wheelAccumulator > 0 ? -1 : 1;
      wheelAccumulator = 0;
      applyTypography(getNextTypography(step));
    };

    // --- Touch (two-finger pinch on touchscreen) -----------------------------
    let pinchInitialDistance = 0;
    let pinchInitialFontSize = 0;
    let pinchLastAppliedSize = 0;
    let isPinching = false;

    const getTouchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const handleTouchStart = (event) => {
      if (event.touches.length !== 2) return;
      const distance = getTouchDistance(event.touches);
      if (distance <= 0) return;

      isPinching = true;
      pinchInitialDistance = distance;
      pinchInitialFontSize = useConfigStore.getState().fontSize || DEFAULT_FONT_SIZE;
      pinchLastAppliedSize = pinchInitialFontSize;
    };

    const handleTouchMove = (event) => {
      if (!isPinching || event.touches.length !== 2) return;
      const distance = getTouchDistance(event.touches);
      if (distance <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const scale = distance / pinchInitialDistance;
      const nextSize = clampFontSize(Math.round(pinchInitialFontSize * scale));
      if (nextSize === pinchLastAppliedSize) return;

      pinchLastAppliedSize = nextSize;
      applyTypography(computeTypographyForSize(nextSize));
    };

    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) {
        isPinching = false;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      if (wheelResetTimer) clearTimeout(wheelResetTimer);
      container.removeEventListener('wheel', handleWheel, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [activeTabId, setConfig]);

  if (!activeTabMeta) {
    return (
      <main className={`editor-content ${isMobileLayout ? 'editor-content--mobile' : ''}`}>
        <div className="editor-content__empty">
          <div className="editor-content__empty-logo">M</div>
          <div className="editor-content__empty-title">{t('editor.empty.title')}</div>
          <div className="editor-content__empty-hint">{t('editor.empty.hint')}</div>
        </div>
      </main>
    );
  }

  const isMarkdown = /\.(md|markdown|mdx)$/i.test(activeTabMeta.name);

  return (
    <main className={`editor-content ${isMobileLayout ? 'editor-content--mobile' : ''}`}>
      <ToastContainer />
      <div
        className={`editor-content__workspace ${viewMode === 'split' && isMobileLayout ? 'editor-content__workspace--mobile-split' : ''}`}
        ref={containerRef}
        style={viewMode === 'split' ? { '--split-ratio': `${splitRatio * 100}%` } : undefined}
      >
        {viewMode === 'edit' && (
          <MonacoEditor
            key={activeTabId}
            ref={monacoRef}
            className="editor-content__editor"
            onAutoSave={triggerAutoSave}
          />
        )}
        {viewMode === 'preview' && isMarkdown && (
          <Suspense fallback={<PreviewFallback />}>
            <MilkdownMarkdownEditor
              key={activeTabId}
              ref={monacoRef}
              className="editor-content__preview editor-content__editor--milkdown"
              onAutoSave={triggerAutoSave}
            />
          </Suspense>
        )}
        {viewMode === 'split' && isMarkdown && (
          <>
            <MonacoEditor
              key={`${activeTabId}-split`}
              ref={monacoRef}
              className="editor-content__editor editor-content__editor--half"
              onAutoSave={triggerAutoSave}
            />
            <Tooltip title={t('editor.splitDivider')} placement="top" mouseEnterDelay={0.5}>
              <div
                className="editor-content__split-divider"
                onPointerDown={handleDividerPointerDown}
              />
            </Tooltip>
            <Suspense fallback={<PreviewFallback />}>
              <MarkdownPreview className="editor-content__preview editor-content__preview--half" />
            </Suspense>
          </>
        )}
        {!isMarkdown && viewMode !== 'edit' && (
          <MonacoEditor
            key={`${activeTabId}-fallback`}
            ref={monacoRef}
            className="editor-content__editor"
            onAutoSave={triggerAutoSave}
          />
        )}

        <div className="editor-content__fade" />
      </div>

      {/* FloatingToolbar is outside workspace to avoid overflow:hidden clipping */}
      {isMarkdown && (
        <FloatingToolbar onInsert={handleToolbarInsert} />
      )}
    </main>
  );
}

export default EditorContent;
