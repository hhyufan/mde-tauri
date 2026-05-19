import { useEffect } from 'react';

// Reads safe-area insets from the WebView (notch + system bars) and overlays
// the on-screen keyboard inset from the Visual Viewport API. Everything is
// published as CSS custom properties on <html> so the rest of the app can
// consume them via env(safe-area-inset-*) and var(--mde-kb-inset).
//
// Why CSS variables instead of state: this fires on every keyboard frame and
// orientation change. Pushing it through React would re-render half the tree.

const KB_VAR = '--mde-kb-inset';
const KB_OPEN_CLASS = 'mde--kb-open';
// Below this on-screen keyboard size we treat the difference as Android nav
// bar / browser chrome jitter rather than the IME being open. Keeps the UI
// from "twitching" when the system status bar height fluctuates by a few px.
const KB_OPEN_THRESHOLD = 100;

function applyKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty(KB_VAR, '0px');
    document.documentElement.classList.remove(KB_OPEN_CLASS);
    return;
  }

  // visualViewport.height is the visible area; subtracting from layout
  // viewport height (window.innerHeight) gives the part covered by the
  // keyboard or other system UI. Negative values can occur during
  // orientation changes; clamp to 0.
  const layoutHeight = window.innerHeight;
  const visibleHeight = vv.height + vv.offsetTop;
  const inset = Math.max(0, layoutHeight - visibleHeight);

  document.documentElement.style.setProperty(KB_VAR, `${inset}px`);
  if (inset > KB_OPEN_THRESHOLD) {
    document.documentElement.classList.add(KB_OPEN_CLASS);
  } else {
    document.documentElement.classList.remove(KB_OPEN_CLASS);
  }
}

export function useViewportInsets() {
  useEffect(() => {
    applyKeyboardInset();

    const vv = window.visualViewport;
    const handler = () => applyKeyboardInset();

    vv?.addEventListener('resize', handler);
    vv?.addEventListener('scroll', handler);
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);

    return () => {
      vv?.removeEventListener('resize', handler);
      vv?.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);
}
