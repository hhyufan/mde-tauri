(() => {
  // This is a static public asset, not a Vite module. Use the injected IPC
  // bridge directly; a bare @tauri-apps/api import cannot resolve in production.
  let theme;
  try {
    const stored = localStorage.getItem('mokidown-theme') || localStorage.getItem('mde-theme');
    theme = stored ? JSON.parse(stored)?.state?.theme : null;
  } catch { /* Use the system preference if stored settings are invalid. */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;

  const prepare = async () => {
    const image = document.querySelector('.card__image');
    image.src = theme === 'dark' ? './hello-dark.png' : './hello-light.png';
    try { await image.decode(); }
    catch { image.hidden = true; }
    // Hidden WebViews may throttle animation frames. Give layout a chance to
    // commit, with a short fallback so readiness never depends on visibility.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 80);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    });
    const bridge = window.__TAURI_INTERNALS__;
    if (bridge?.invoke) {
      try { await bridge.invoke('splash_ready', { dark: theme === 'dark' }); }
      catch (error) { console.warn('[startup] Could not reveal splash:', error); }
    }
    document.querySelector('.card').classList.add('card--visible');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepare, { once: true });
  else void prepare();
})();
