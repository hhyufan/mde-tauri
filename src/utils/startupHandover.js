// The native coordinator owns splash timing and window focus. This page only
// announces that React and its editor runtime are ready, with a bounded wait.
export function announceMainWindowReady(preparation, timeoutMs = 1500) {
  const bridge = window.__TAURI_INTERNALS__;
  if (!bridge?.invoke) return () => {};
  let cancelled = false;
  let sent = false;
  const send = () => {
    if (cancelled || sent) return;
    sent = true;
    clearTimeout(timer);
    bridge.invoke('main_window_ready', { dark: document.documentElement.dataset.theme === 'dark' })
      .catch((error) => console.warn('[startup] Could not announce main window readiness:', error));
  };
  const timer = setTimeout(send, timeoutMs);
  Promise.resolve(preparation).catch((error) => console.warn('[startup] Editor preload failed:', error)).then(send);
  return () => { cancelled = true; clearTimeout(timer); };
}
