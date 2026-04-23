import { useCallback, useRef } from 'react';

/**
 * Returns an onMouseDown handler to put on the custom scrollbar thumb.
 * Dragging the thumb moves the scroll container proportionally.
 *
 * @param {React.RefObject} scrollRef   - ref on the scrollable content element
 * @param {Function}        updateScrollbar - callback that repositions the thumb after scrolling
 * @returns {{ onThumbMouseDown }} - spread onto the thumb element
 */
export function useHorizontalDragScroll(scrollRef, updateScrollbar) {
  const startX = useRef(0);
  const startScrollLeft = useRef(0);

  const onMouseMove = useCallback((e) => {
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - startX.current;
    // Convert thumb px movement → content px movement
    const scrollRatio = el.scrollWidth / el.clientWidth;
    el.scrollLeft = startScrollLeft.current + dx * scrollRatio;
    updateScrollbar?.();
  }, [scrollRef, updateScrollbar]);

  const onMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [onMouseMove]);

  const onThumbMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    startX.current = e.clientX;
    startScrollLeft.current = el.scrollLeft;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [scrollRef, onMouseMove, onMouseUp]);

  return { onThumbMouseDown };
}
