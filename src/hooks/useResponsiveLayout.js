/**
 * ??????? Hook ???
 *
 * ???????????????????????????????
 */
import { useEffect, useMemo, useState } from 'react';
import {
  isAndroidRuntime,
  isMobileViewport,
  isPortraitOrientation,
  isTouchLikeDevice,
  MOBILE_BREAKPOINT,
} from '@utils/platform';

/**
 * 采集当前平台与视口快照，供响应式布局统一消费。
 */
function getSnapshot() {
  return {
    isAndroid: isAndroidRuntime(),
    isMobileLayout: isMobileViewport(),
    isPortrait: isPortraitOrientation(),
    isTouchLike: isTouchLikeDevice(),
  };
}

/**
 * 响应式布局 Hook。
 *
 * 统一监听窗口尺寸和横竖屏变化，向上层提供移动端布局判断、触控能力以及
 * Android 运行时标识，避免组件各自重复订阅浏览器事件。
 */
export function useResponsiveLayout() {
  const [snapshot, setSnapshot] = useState(getSnapshot);

  useEffect(() => {
    const mq = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const orientationMq = window.matchMedia?.('(orientation: portrait)');
    // 所有订阅源共用一个刷新函数，确保派生状态保持一致。
    const update = () => setSnapshot(getSnapshot());

    window.addEventListener('resize', update);
    mq?.addEventListener?.('change', update);
    orientationMq?.addEventListener?.('change', update);
    update();

    return () => {
      window.removeEventListener('resize', update);
      mq?.removeEventListener?.('change', update);
      orientationMq?.removeEventListener?.('change', update);
    };
  }, []);

  return useMemo(() => snapshot, [snapshot]);
}
