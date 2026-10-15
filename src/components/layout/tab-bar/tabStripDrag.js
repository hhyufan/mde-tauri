// 使用指针事件，避免 Windows WebView 的原生文件拖放接管 HTML drag/drop。
export function installTabStripDrag(container, { onDragChange, onDropTarget, onReorder }) {
  let gesture = null;
  let frame = null;
  let suppressClick = false;

  const locate = () => {
    const tabs = [...container.querySelectorAll('[data-tab-id]')];
    const target = tabs.find((tab) => gesture.x < tab.getBoundingClientRect().right) || tabs.at(-1);
    if (!target) return null;
    const box = target.getBoundingClientRect();
    return { id: target.dataset.tabId, after: gesture.x > box.left + box.width / 2 };
  };
  const tick = () => {
    if (!gesture?.dragging) return;
    const box = container.getBoundingClientRect();
    const speed = gesture.x < box.left + 32 ? -10 : gesture.x > box.right - 32 ? 10 : 0;
    if (speed) container.scrollBy({ left: speed, behavior: 'instant' });
    gesture.target = locate();
    onDropTarget(gesture.target);
    frame = requestAnimationFrame(tick);
  };
  const finish = (commit) => {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    cancelAnimationFrame(frame);
    if (container.hasPointerCapture?.(current.pointerId)) container.releasePointerCapture(current.pointerId);
    if (!current.dragging) return;
    suppressClick = true;
    if (commit && current.target) onReorder(current.id, current.target.id, current.target.after);
    onDragChange(null);
    onDropTarget(null);
  };
  const down = (event) => {
    suppressClick = false;
    if (gesture || event.button !== 0 || event.isPrimary === false) return;
    if (event.target.closest('input, button, .tabbar__tab-close, .tabbar__tab--renaming')) return;
    const tab = event.target.closest('[data-tab-id]');
    if (!tab || !container.contains(tab)) return;
    gesture = { id: tab.dataset.tabId, pointerId: event.pointerId, startX: event.clientX, x: event.clientX, dragging: false };
  };
  const move = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    if (!gesture.dragging && Math.abs(gesture.x - gesture.startX) >= 6) {
      gesture.dragging = true;
      container.setPointerCapture(event.pointerId);
      onDragChange(gesture.id);
      tick();
    }
    if (gesture.dragging) {
      event.preventDefault();
      gesture.target = locate();
      onDropTarget(gesture.target);
    }
  };
  const up = (event) => {
    if (event.pointerId !== gesture?.pointerId) return;
    if (gesture.dragging) {
      gesture.x = event.clientX;
      gesture.target = locate();
      event.preventDefault();
    }
    finish(true);
  };
  const cancel = () => finish(false);
  const key = (event) => { if (event.key === 'Escape') cancel(); };
  const click = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const nativeDrag = (event) => event.preventDefault();
  const listeners = { pointerdown: down, pointercancel: cancel, lostpointercapture: cancel, dragstart: nativeDrag };
  for (const [type, handler] of Object.entries(listeners)) container.addEventListener(type, handler);
  container.addEventListener('click', click, true);
  window.addEventListener('keydown', key);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('blur', cancel);
  return () => {
    cancel();
    for (const [type, handler] of Object.entries(listeners)) container.removeEventListener(type, handler);
    container.removeEventListener('click', click, true);
    window.removeEventListener('keydown', key);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('blur', cancel);
  };
}
