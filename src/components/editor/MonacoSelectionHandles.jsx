import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './monaco-selection-handles.scss';

// A pair of draggable handles anchored at the visible start / end of the
// current Monaco selection. They mimic Android's system text-selection
// handles so users can extend or shrink a long-press selection — Monaco
// never surfaces the native ones because the visible text isn't inside
// the focused textarea.
//
// Implementation notes:
//   - Positioned via fixed + screen coordinates derived from Monaco's
//     `getScrolledVisiblePosition`. The handle's "tip" anchors at the
//     selection's baseline; the body extends down where the thumb sits.
//   - During a drag we pin the OPPOSITE end of the selection as an
//     anchor and let the dragged end follow the finger; Monaco then
//     normalises start/end ordering automatically when we cross over.
//   - The probe Y is offset above the finger by ~28px so the hand
//     doesn't obscure the text the user is trying to target (mimics the
//     OS magnifier offset without the magnifier itself).

const FINGER_Y_OFFSET = 28;
const SCREEN_MARGIN = 4;

function snapshotPositions(editor) {
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

  // y = bottom of the glyph row (where the handle's tip anchors).
  return {
    startX: rect.left + visStart.left,
    startY: rect.top + visStart.top + (visStart.height || 20),
    endX: rect.left + visEnd.left,
    endY: rect.top + visEnd.top + (visEnd.height || 20),
    // Cache editor bounds so we can clamp the handle into the editor
    // even when the selection has scrolled off-screen.
    editorLeft: rect.left,
    editorRight: rect.right,
    editorTop: rect.top,
    editorBottom: rect.bottom,
  };
}

export default function MonacoSelectionHandles({ editor, enabled = true }) {
  const [positions, setPositions] = useState(null);
  const draggingRef = useRef(null);
  const startHandleRef = useRef(null);
  const endHandleRef = useRef(null);

  // ----- Track selection / scroll so handles follow ----------------------
  useEffect(() => {
    if (!enabled || !editor) {
      setPositions(null);
      return undefined;
    }

    let rafId = 0;
    const refresh = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const next = snapshotPositions(editor);
        setPositions(next);
      });
    };

    const disposables = [
      editor.onDidChangeCursorSelection(refresh),
      editor.onDidScrollChange(refresh),
      editor.onDidChangeModel(refresh),
      editor.onDidLayoutChange(refresh),
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

  // ----- Pointer drag handlers -------------------------------------------
  const handlePointerDown = (side) => (e) => {
    if (!editor) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = editor.getSelection();
    if (!sel) return;

    const handleEl = e.currentTarget;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // Capture can throw on detached nodes; pointer events still flow
      // to the document level so the drag continues, just less reliably
      // when the finger leaves the handle's visible area.
    }

    // The opposite end of the selection becomes the fixed anchor for the
    // duration of this drag. Even if the user drags past the anchor and
    // Monaco swaps start/end ordering, our anchor stays put so the
    // selection geometry stays predictable.
    const anchor = side === 'start'
      ? { lineNumber: sel.endLineNumber, column: sel.endColumn }
      : { lineNumber: sel.startLineNumber, column: sel.startColumn };

    draggingRef.current = { pointerId: e.pointerId, anchor, side, handleEl };
    document.documentElement.classList.add('mde--selection-dragging');
  };

  const handlePointerMove = (e) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();

    // Probe one line above the finger so the user's hand doesn't cover
    // the character they're trying to land on.
    const probeY = e.clientY - FINGER_Y_OFFSET;
    let target = editor.getTargetAtClientPoint(e.clientX, probeY);
    if (!target?.position) {
      // If the offset went above the editor (top of file), retry at the
      // finger's actual Y so the user can still reach line 1.
      target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
    }
    const newPos = target?.position;
    if (!newPos) return;

    editor.setSelection({
      startLineNumber: drag.anchor.lineNumber,
      startColumn: drag.anchor.column,
      endLineNumber: newPos.lineNumber,
      endColumn: newPos.column,
    });
  };

  const handlePointerUp = (e) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      drag.handleEl?.releasePointerCapture?.(e.pointerId);
    } catch (_) {
      // Already released; nothing to do.
    }
    draggingRef.current = null;
    document.documentElement.classList.remove('mde--selection-dragging');
    editor?.focus();
  };

  if (!enabled || !positions) return null;

  // Clamp handles into the screen so they don't disappear when the
  // selection is partially scrolled out of view; they still drag fine
  // because Monaco's getTargetAtClientPoint accepts any client coord.
  const clampX = (x) => Math.min(
    Math.max(x, SCREEN_MARGIN),
    window.innerWidth - SCREEN_MARGIN,
  );

  return createPortal(
    <>
      <span
        ref={startHandleRef}
        className="monaco-selection-handle monaco-selection-handle--start"
        style={{ left: `${clampX(positions.startX)}px`, top: `${positions.startY}px` }}
        onPointerDown={handlePointerDown('start')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <span
        ref={endHandleRef}
        className="monaco-selection-handle monaco-selection-handle--end"
        style={{ left: `${clampX(positions.endX)}px`, top: `${positions.endY}px` }}
        onPointerDown={handlePointerDown('end')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </>,
    document.body,
  );
}
