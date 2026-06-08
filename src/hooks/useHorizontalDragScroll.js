/**
 * ?????? Hook ???
 *
 * ????????????????????????????????????
 */
import { useCallback, useRef } from 'react';

/**
 * 返回一个用于自定义横向滚动条滑块的 `onMouseDown` 处理器。
 * 用户拖动滑块时，会按内容区与可视区的比例同步移动真实滚动位置。
 *
 * @param {React.RefObject} scrollRef 可滚动内容节点的 ref
 * @param {Function} updateScrollbar 滚动后用于刷新滑块位置的回调
 * @returns {{ onThumbMouseDown }} 可直接展开到滑块元素上的事件集合
 */
export function useHorizontalDragScroll(scrollRef, updateScrollbar) {
  const startX = useRef(0);
  const startScrollLeft = useRef(0);

  const onMouseMove = useCallback((e) => {
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - startX.current;
    // 将滑块移动的像素距离换算成内容区应滚动的像素距离。
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
