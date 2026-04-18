import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { syncEngine } from '@/services/syncEngine';
import useAuthStore from '@store/useAuthStore';
import './sync-status.scss';

const SyncIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const CloudOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const CloudIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

const STATUS_ICON_MAP = {
  idle: CloudIcon,
  syncing: SyncIcon,
  synced: CheckIcon,
  error: AlertIcon,
  offline: CloudOffIcon,
};

function SyncStatusIndicator() {
  const { t } = useTranslation();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [status, setStatus] = useState(syncEngine.status);

  useEffect(() => {
    return syncEngine.onStatusChange(setStatus);
  }, []);

  if (!isLoggedIn) return null;

  const IconComponent = STATUS_ICON_MAP[status] || CloudIcon;

  return (
    <span
      className={`sync-status sync-status--${status}`}
      onClick={() => syncEngine.fullSync()}
      title={t(`sync.status.${status}`)}
    >
      <span className="sync-status__icon"><IconComponent /></span>
      <span className="sync-status__label">{t(`sync.status.${status}`)}</span>
    </span>
  );
}

export default SyncStatusIndicator;
