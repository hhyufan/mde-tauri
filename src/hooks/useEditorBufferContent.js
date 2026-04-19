import { useEffect, useRef, useState } from 'react';
import { getBuffer, subscribe } from '@utils/editorBuffer';

/**
 * Subscribe to the editor buffer for a given tab id, returning the
 * latest content as React state. The subscription is debounced so that
 * heavy consumers (Markdown preview, outline) only re-render after the
 * user pauses typing.
 *
 * The debounce is adaptive: very long documents need more breathing
 * room before we hand the new string to React, otherwise the parse +
 * render cost can starve the editor's own keystroke handler and make
 * typing feel laggy.
 */
function pickDelay(baseDelay, contentLength) {
  if (contentLength > 200_000) return Math.max(baseDelay, 700);
  if (contentLength > 80_000) return Math.max(baseDelay, 480);
  if (contentLength > 30_000) return Math.max(baseDelay, 340);
  return baseDelay;
}

export function useEditorBufferContent(tabId, fallback = '', delay = 220) {
  const [content, setContent] = useState(() => getBuffer(tabId, fallback));
  const tabIdRef = useRef(tabId);
  const fallbackRef = useRef(fallback);
  tabIdRef.current = tabId;
  fallbackRef.current = fallback;

  useEffect(() => {
    setContent(getBuffer(tabId, fallback));
  }, [tabId, fallback]);

  useEffect(() => {
    let timer = null;
    const unsub = subscribe((ids) => {
      if (!ids.has(tabIdRef.current)) return;
      if (timer) clearTimeout(timer);
      const next = getBuffer(tabIdRef.current, fallbackRef.current);
      const actualDelay = pickDelay(delay, next?.length || 0);
      timer = setTimeout(() => {
        setContent(getBuffer(tabIdRef.current, fallbackRef.current));
      }, actualDelay);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [delay]);

  return content;
}

export default useEditorBufferContent;
