import { useLayoutEffect } from 'react';
import { getDocumentViewState, registerDocumentViewState, requestDocumentViewStateSave } from '@utils/documentViewState';

// Rendered previews may gain height after worker analysis or image decoding.
// Keep retrying the initial offset until content fits; user input takes priority.
export function useDocumentScrollState(ref, tabId, surface, ready = true) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !tabId || !ready) return undefined;
    const saved = getDocumentViewState(tabId, surface);
    let restoring = Boolean(saved && (saved.top > 0 || saved.left > 0));
    const apply = () => {
      if (!restoring) return;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left || 0;
      if (Math.abs(element.scrollTop - saved.top) < 1) {
        restoring = false;
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(apply);
    if (restoring) observer.observe(element, { childList: true, subtree: true });
    const cancelRestore = () => { restoring = false; observer.disconnect(); };
    const save = () => { if (!restoring) requestDocumentViewStateSave(); };
    const stopView = registerDocumentViewState(surface, () => tabId, () =>
      restoring ? saved : { top: element.scrollTop, left: element.scrollLeft });
    element.addEventListener('scroll', save, { passive: true });
    element.addEventListener('wheel', cancelRestore, { passive: true });
    element.addEventListener('pointerdown', cancelRestore);
    element.addEventListener('keydown', cancelRestore);
    element.addEventListener('load', apply, true);
    apply();
    return () => {
      stopView(); observer.disconnect();
      element.removeEventListener('scroll', save);
      element.removeEventListener('wheel', cancelRestore);
      element.removeEventListener('pointerdown', cancelRestore);
      element.removeEventListener('keydown', cancelRestore);
      element.removeEventListener('load', apply, true);
    };
  }, [ref, tabId, surface, ready]);
}
