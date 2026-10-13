import { useCallback, useEffect, useState } from 'react';

export function useEditorContextMenu(resetKey) {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((event, items, variant) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items, variant });
  }, []);
  useEffect(closeMenu, [closeMenu, resetKey]);
  return { menu, openMenu, closeMenu };
}
