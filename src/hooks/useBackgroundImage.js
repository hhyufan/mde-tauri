import { useEffect, useState } from 'react';
import useConfigStore from '@store/useConfigStore';
import { readBackgroundImage } from '@utils/backgroundImage';

/** 在切换图片和卸载时释放 Blob URL，异步读取旧图片不能覆盖新选择。 */
export function useBackgroundImage() {
  const id = useConfigStore((state) => state.backgroundImage);
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    let url;
    readBackgroundImage(id)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) throw new Error('Background image not found');
        url = URL.createObjectURL(blob);
        setLoaded({ id, url });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, error: true });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return loaded?.id === id ? loaded : {};
}
