import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './mobile-selection-bar.scss';

// Touch-friendly action bar that floats above the current Monaco selection.
//
// Why this exists:
//   - Monaco renders text into its own DOM and consumes touch events through
//     its TouchHandler, so neither the OS text-selection action bar nor the
//     desktop right-click context menu surface naturally on Android.
//   - Monaco's built-in clipboard *actions* (`editor.action.clipboardCutAction`
//     etc.) rely on `document.execCommand`, which is unreliable inside the
//     Tauri Android WebView. We therefore go through `navigator.clipboard`
//     directly and apply the edits via `executeEdits`, mirroring the pattern
//     miaogu-notepad uses for its desktop context menu.
//
// Trigger paths:
//   1. `editor.onContextMenu` — registered in MonacoEditor; selects a word
//      via smartSelect.expand on long-press / right-click and the resulting
//      selection change makes this bar appear.
//   2. Touch long-press fallback — some Android WebViews don't fire
//      `contextmenu` on view nodes with `user-select: none`. The
//      pointerdown/up timer below catches that case, walks the click coord
//      through `editor.getTargetAtClientPoint` and selects the word
//      manually.

const BAR_GAP_ABOVE = 12;
const BAR_HEIGHT = 40;
const BAR_MARGIN = 8;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 10; // px before the touch is treated as a drag

function computeBarPosition(editor) {
  if (!editor) return null;
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return null;

  const startPos = selection.getStartPosition();
  const endPos = selection.getEndPosition();
  const visStart = editor.getScrolledVisiblePosition(startPos);
  const visEnd = editor.getScrolledVisiblePosition(endPos);
  if (!visStart || !visEnd) return null;

  const editorDomNode = editor.getDomNode();
  if (!editorDomNode) return null;
  const rect = editorDomNode.getBoundingClientRect();

  const anchorX = rect.left + (visStart.left + visEnd.left) / 2;
  const aboveY = rect.top + visStart.top - BAR_GAP_ABOVE - BAR_HEIGHT;
  const belowY = rect.top + visEnd.top + (visEnd.height || 20) + BAR_GAP_ABOVE;

  let y = aboveY;
  if (aboveY < BAR_MARGIN) y = belowY;

  return { x: anchorX, y };
}

function selectWordAt(editor, position) {
  if (!editor || !position) return false;
  const model = editor.getModel();
  if (!model) return false;
  const word = model.getWordAtPosition(position);
  if (!word) {
    editor.setPosition(position);
    return false;
  }
  editor.setSelection({
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn,
  });
  return true;
}

export default function MobileSelectionBar({ editor, enabled = true, containerRef }) {
  const { t } = useTranslation();
  const barRef = useRef(null);
  const [state, setState] = useState({ visible: false, x: 0, y: 0 });

  // --- Long-press fallback (when onContextMenu doesn't fire) ---------------
  useEffect(() => {
    if (!enabled || !editor) return undefined;
    const container = containerRef?.current;
    if (!container) return undefined;

    let timerId = 0;
    let activeId = null;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = 0;
      }
      activeId = null;
    };

    const onPointerDown = (e) => {
      // Only react to a single primary touch; let mouse + multi-touch fall
      // through to Monaco's own handlers.
      if (e.pointerType !== 'touch' || !e.isPrimary) {
        cancel();
        return;
      }
      activeId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;

      cancel();
      timerId = setTimeout(() => {
        timerId = 0;
        if (activeId === null) return;
        const target = editor.getTargetAtClientPoint(startX, startY);
        const position = target?.position;
        if (!position) return;
        editor.focus();
        selectWordAt(editor, position);
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e) => {
      if (!timerId || e.pointerId !== activeId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    };

    const onPointerEnd = (e) => {
      if (e.pointerId === activeId) cancel();
    };

    container.addEventListener('pointerdown', onPointerDown, { passive: true });
    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerup', onPointerEnd, { passive: true });
    container.addEventListener('pointercancel', onPointerEnd, { passive: true });

    return () => {
      cancel();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd);
      container.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [editor, enabled, containerRef]);

  // --- Bar positioning + visibility ---------------------------------------
  useEffect(() => {
    if (!enabled || !editor) {
      setState((s) => (s.visible ? { ...s, visible: false } : s));
      return undefined;
    }

    let rafId = 0;
    const refresh = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const pos = computeBarPosition(editor);
        if (!pos) {
          setState((s) => (s.visible ? { ...s, visible: false } : s));
          return;
        }
        const width = barRef.current?.offsetWidth ?? 240;
        const halfWidth = width / 2;
        const minX = BAR_MARGIN + halfWidth;
        const maxX = window.innerWidth - BAR_MARGIN - halfWidth;
        const clampedX = Math.min(Math.max(pos.x, minX), maxX);
        const maxY = window.innerHeight - BAR_MARGIN - BAR_HEIGHT;
        const clampedY = Math.min(Math.max(pos.y, BAR_MARGIN), maxY);
        setState({ visible: true, x: clampedX, y: clampedY });
      });
    };

    const disposables = [
      editor.onDidChangeCursorSelection(refresh),
      editor.onDidScrollChange(refresh),
      editor.onDidChangeModel(refresh),
    ];

    refresh();

    const handleResize = () => refresh();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      disposables.forEach((d) => d.dispose?.());
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, [editor, enabled]);

  // --- Action handlers ----------------------------------------------------
  // Clipboard ops go through navigator.clipboard so they work reliably in
  // the Android WebView (Monaco's built-in actions rely on execCommand and
  // often fail silently on mobile).
  const getSelectionText = () => {
    if (!editor) return '';
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || selection.isEmpty()) return '';
    return model.getValueInRange(selection);
  };

  const handleCopy = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const text = getSelectionText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Last resort: fall back to Monaco's action (uses execCommand).
      editor?.trigger('selection-bar', 'editor.action.clipboardCopyAction', null);
    }
    editor?.focus();
  };

  const handleCut = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!editor) return;
    const selection = editor.getSelection();
    const text = getSelectionText();
    if (!text || !selection) return;
    try {
      await navigator.clipboard.writeText(text);
      editor.executeEdits('selection-bar-cut', [{ range: selection, text: '' }]);
    } catch (_) {
      editor.trigger('selection-bar', 'editor.action.clipboardCutAction', null);
    }
    editor.focus();
  };

  const handlePaste = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      // Use the current selection if there is one (replace); otherwise
      // synthesize a zero-width range at the cursor (pure insert).
      const selection = editor.getSelection();
      const pos = editor.getPosition();
      const range = selection ?? (pos
        ? { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }
        : null);
      if (!range) return;
      editor.executeEdits('selection-bar-paste', [{ range, text, forceMoveMarkers: true }]);
    } catch (_) {
      editor.trigger('selection-bar', 'editor.action.clipboardPasteAction', null);
    }
    editor.focus();
  };

  const handleSelectAll = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const fullRange = model.getFullModelRange();
    editor.setSelection(fullRange);
    editor.focus();
  };

  if (!state.visible) return null;

  const items = [
    { key: 'cut', label: t('editor.menu.cut'), onClick: handleCut },
    { key: 'copy', label: t('editor.menu.copy'), onClick: handleCopy },
    { key: 'paste', label: t('editor.menu.paste'), onClick: handlePaste },
    { key: 'selectAll', label: t('editor.menu.selectAll'), onClick: handleSelectAll },
  ];

  return createPortal(
    <div
      ref={barRef}
      className="mobile-selection-bar"
      style={{ left: `${state.x}px`, top: `${state.y}px` }}
      // Prevent the editor from losing focus / collapsing the selection on
      // the touch-down phase, before our click handler runs.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="mobile-selection-bar__btn"
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
