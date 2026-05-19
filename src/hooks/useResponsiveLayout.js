import { useEffect, useMemo, useState } from 'react';
import {
  isAndroidRuntime,
  isMobileViewport,
  isPortraitOrientation,
  isTouchLikeDevice,
  MOBILE_BREAKPOINT,
} from '@utils/platform';

function getSnapshot() {
  return {
    isAndroid: isAndroidRuntime(),
    isMobileLayout: isMobileViewport(),
    isPortrait: isPortraitOrientation(),
    isTouchLike: isTouchLikeDevice(),
  };
}

export function useResponsiveLayout() {
  const [snapshot, setSnapshot] = useState(getSnapshot);

  useEffect(() => {
    const mq = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const orientationMq = window.matchMedia?.('(orientation: portrait)');
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
