import { useEffect, useRef } from 'react';
import useNotificationStore from '@store/useNotificationStore';
import { cn } from '@utils/classNames';
import './notification.scss';

const ICONS = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

function NotificationItem({ notification }) {
  const dismiss = useNotificationStore((s) => s.dismiss);
  const progressRef = useRef(null);

  useEffect(() => {
    const el = progressRef.current;
    if (el && notification.duration > 0) {
      el.style.transitionDuration = notification.duration + 'ms';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.width = '0%';
        });
      });
    }
  }, [notification.duration]);

  return (
    <div className={cn('notif', `notif--${notification.type}`)}>
      <div className="notif__icon">{ICONS[notification.type]}</div>
      <div className="notif__body">
        <div className="notif__title">{notification.title}</div>
        {notification.message && <div className="notif__message">{notification.message}</div>}
      </div>
      <button className="notif__close" onClick={() => dismiss(notification.id)}>
        &times;
      </button>
      <div className="notif__progress" ref={progressRef} style={{ width: '100%' }} />
    </div>
  );
}

function NotificationContainer() {
  const notifications = useNotificationStore((s) => s.notifications);

  return (
    <div className="notif-container">
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </div>
  );
}

export default NotificationContainer;
