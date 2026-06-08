/**
 * ?????????? Hook ???
 *
 * ? React ????? `editorBuffer` ???????????????????
 * ????????????
 */
import { useEffect, useRef, useState } from 'react';
import { getBuffer, subscribe } from '@utils/editorBuffer';

/**
 * 订阅指定标签页的编辑器缓冲区，并以 React state 的形式返回最新内容。
 * 这里对订阅回调做了防抖，避免 Markdown 预览、大纲这类较重的消费者
 * 在用户连续输入时频繁重渲染。
 *
 * 防抖时长会按文档长度自适应调整：超长文本会获得更大的缓冲时间，
 * 否则解析和渲染开销可能挤占编辑器自身的按键处理，造成输入发黏或掉帧。
 */
function pickDelay(baseDelay, contentLength) {
  if (contentLength > 200_000) return Math.max(baseDelay, 700);
  if (contentLength > 80_000) return Math.max(baseDelay, 480);
  if (contentLength > 30_000) return Math.max(baseDelay, 340);
  return baseDelay;
}

/**
 * ????????????????? React state ????????
 */
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
