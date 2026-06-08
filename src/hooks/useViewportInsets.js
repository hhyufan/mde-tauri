/**
 * 视口安全区与软键盘遮挡同步 Hook。
 *
 * 本文件负责从 WebView 与 Visual Viewport API 读取安全区和软键盘占位信息，
 * 并把结果写入 `<html>` 上的 CSS 变量，避免高频事件触发 React 大面积重渲染。
 */
import { useEffect } from 'react';

const KB_VAR = '--mde-kb-inset';
const KB_OPEN_CLASS = 'mde--kb-open';
// 低于该阈值时，将高度差视为 Android 导航栏或浏览器外壳抖动，而不是输入法已打开，
// 以免系统栏高度轻微波动时页面跟着抖动。
const KB_OPEN_THRESHOLD = 100;

/**
 * 计算当前软键盘遮挡高度，并同步到根元素 CSS 变量与状态类名上。
 */
function applyKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty(KB_VAR, '0px');
    document.documentElement.classList.remove(KB_OPEN_CLASS);
    return;
  }

  // `visualViewport.height` 表示当前可见区域高度；
  // 用布局视口高度（`window.innerHeight`）减去它，
  // 就能得到被键盘或其他系统 UI 遮挡的部分。
  // 横竖屏切换过程中可能出现负值，因此这里强制限制为 0。
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

/**
 * 监听视口尺寸变化，并持续维护软键盘遮挡高度对应的 CSS 变量。
 */
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
