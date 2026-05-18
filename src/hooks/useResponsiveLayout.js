import { useEffect, useMemo, useState } from 'react';
import { isAndroidRuntime, isMobileViewport, isTouchLikeDevice, MOBILE_BREAKPOINT } from '@utils/platform';

function getSnapshot() {
  return {
    isAndroid: isAndroidRuntime(),
    isMobileLayout: isMobileViewport(),
    isTouchLike: isTouchLikeDevice(),
  };
}

export function useResponsiveLayout() {
  const [snapshot, setSnapshot] = useState(getSnapshot);

  useEffect(() => {
    const mq = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const update = () => setSnapshot(getSnapshot());

    window.addEventListener('resize', update);
    mq?.addEventListener?.('change', update);
    update();

    return () => {
      window.removeEventListener('resize', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);

  return useMemo(() => snapshot, [snapshot]);
}
