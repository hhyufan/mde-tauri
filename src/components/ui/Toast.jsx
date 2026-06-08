import { useEffect, useRef } from 'react';
import useToastStore from '@store/useToastStore';
import './toast.scss';

/**
 * 轻量提示条单项。
 *
 * 通过底部进度条的宽度动画表现剩余展示时长。
 */
function ToastItem({ toast }) {
  const barRef = useRef(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el || toast.duration <= 0) return;
    el.style.transitionDuration = toast.duration + 'ms';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.width = '0%';
      });
    });
  }, [toast.duration]);

  return (
    <div className="toast">
      <span className="toast__text">{toast.message}</span>
      <div className="toast__bar" ref={barRef} style={{ width: '100%' }} />
    </div>
  );
}

/**
 * 页面内轻提示容器。
 *
 * 通常用于编辑区内部的即时反馈，不与顶部通知混用。
 */
function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

export default ToastContainer;
