// Plain paragraph edits do not require rescanning images, HTML or math. Batch
// relevant DOM changes before paint, including changes caused by node views.
export function observeMarkdownEnhancements(root, selector, enhance, attributes = []) {
  let frame = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; enhance(); });
  };
  const touches = (node) => node instanceof Element
    && (node.matches(selector) || Boolean(node.querySelector(selector)));
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target instanceof Element
      && (record.target.closest(selector)
        || [...record.addedNodes, ...record.removedNodes].some(touches)))) schedule();
  });
  observer.observe(root, { childList: true, subtree: true,
    ...(attributes.length ? { attributes: true, attributeFilter: attributes } : {}) });
  schedule();
  return () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
