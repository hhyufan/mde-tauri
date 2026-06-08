/**
 * 响应式布局与平台探测辅助方法。
 *
 * 统一封装 Android 运行时、移动端断点、触控能力和横竖屏判断，供 Hook 与
 * 组件层按同一标准决定布局策略。
 */
export const MOBILE_BREAKPOINT = 768;

/**
 * 通过 UA 粗略识别当前是否运行在 Android WebView/Tauri 环境。
 */
export function isAndroidRuntime() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

/**
 * 判断当前视口是否落在移动端断点以内。
 */
export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * 判断设备是否更接近触屏交互模型。
 */
export function isTouchLikeDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/**
 * 判断当前是否为竖屏朝向。
 */
export function isPortraitOrientation() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia) {
    return window.matchMedia('(orientation: portrait)').matches;
  }
  return window.innerHeight >= window.innerWidth;
}
