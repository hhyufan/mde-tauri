export function installTabStripWheel(container, surface = container) {
  let target = null, accumulated = 0, lastTime = 0;
  const wheel = (event) => {
    if (event.ctrlKey || event.metaKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.timeStamp - lastTime > 250) { target = null; accumulated = 0; }
    if (Math.sign(accumulated) !== Math.sign(delta)) accumulated = 0;
    lastTime = event.timeStamp;
    accumulated += event.deltaMode ? delta * 40 : delta;
    if (Math.abs(accumulated) < 40) return;
    accumulated = 0;
    const max = Math.max(0, container.scrollWidth - container.clientWidth);
    const box = container.getBoundingClientRect();
    const tabs = [...container.querySelectorAll('[data-tab-id]')];
    const start = tabs[0] ? tabs[0].getBoundingClientRect().left - box.left + container.scrollLeft : 0;
    const stops = [...new Set([0, ...tabs.map((tab) => (
      Math.min(max, Math.max(0, tab.getBoundingClientRect().left - box.left + container.scrollLeft - start))
    )), max])].sort((a, b) => a - b);
    const origin = target ?? container.scrollLeft;
    target = delta > 0 ? stops.find((left) => left > origin + 1) ?? max
      : stops.findLast((left) => left < origin - 1) ?? 0;
    container.scrollTo({ left: target, top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  surface.addEventListener('wheel', wheel, { passive: false });
  return () => surface.removeEventListener('wheel', wheel);
}
