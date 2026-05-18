export const MOBILE_BREAKPOINT = 768;

export function isAndroidRuntime() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

export function isTouchLikeDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}
