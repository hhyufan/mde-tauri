/**
 * 同步状态指示模块。
 *
 * 监听同步引擎状态并将其映射为统一的图标、文本与交互入口，
 * 让用户在界面顶部快速判断当前云同步健康度。
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Popover, Space, Typography } from 'antd';
import { syncEngine } from '@/services/syncEngine';
import useAuthStore from '@store/useAuthStore';
import useConfigStore from '@store/useConfigStore';
import useSyncStore from '@store/useSyncStore';
import { isOwnedByUser } from '@store/userScope';
import { resolveGlobalSyncStatus } from '@/services/sync/syncPresentation';
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
  server_unreachable: CloudOffIcon,
  conflict: AlertIcon,
  auth_required: AlertIcon,
  pending: CloudIcon,
  disabled: CloudOffIcon,
  request_error: AlertIcon,
  server_error: AlertIcon,
  rate_limited: AlertIcon,
  integrity_error: AlertIcon,
  protocol_error: AlertIcon,
  payload_too_large: AlertIcon,
};

/**
 * 云同步状态指示器。
 *
 * 根据同步引擎当前状态切换图标与文案，并提供点击手动触发全量同步的入口。
 *
 * @returns {JSX.Element} 始终显示同步状态入口；未登录时显示离线状态。
 */
function SyncStatusIndicator() {
  const { t } = useTranslation();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const userId = useAuthStore((s) => s.user?.id);
  const syncEnabled = useConfigStore((s) => s.syncEnabled);
  const [status, setStatus] = useState(syncEngine.status);
  const queue = useSyncStore((s) => s.queue);
  const conflicts = useSyncStore((s) => s.conflicts);
  const lastSuccessfulSyncAts = useSyncStore((s) => s.lastSuccessfulSyncAts);
  const lastSyncErrors = useSyncStore((s) => s.lastSyncErrors);

  useEffect(() => {
    return syncEngine.onStatusChange(setStatus);
  }, []);

  const ownedQueue = useMemo(
    () => queue.filter((item) => isOwnedByUser(item?.ownerUserId, userId)),
    [queue, userId],
  );
  const conflictCount = useMemo(
    () => conflicts.filter((item) => isOwnedByUser(item?.ownerUserId, userId)).length,
    [conflicts, userId],
  );
  const blockedCount = ownedQueue.filter((item) => item.status === 'blocked').length;
  const effectiveStatus = resolveGlobalSyncStatus({
    isLoggedIn,
    syncEnabled,
    conflictCount,
    blockedCount,
    pendingCount: ownedQueue.length,
    engineStatus: status,
  });
  const lastSuccessfulSyncAt = Number(lastSuccessfulSyncAts?.[userId] || 0);
  const lastSyncError = lastSyncErrors?.[userId] || null;
  const IconComponent = STATUS_ICON_MAP[effectiveStatus] || CloudIcon;
  const label = t(`sync.status.${effectiveStatus}`);

  return (
    <Popover
      placement="bottomRight"
      title={label}
      content={(
        <Space direction="vertical" size={6}>
          <Typography.Text>{t('sync.pendingCount', { count: ownedQueue.length })}</Typography.Text>
          <Typography.Text>
            {t('sync.lastSuccess', {
              time: lastSuccessfulSyncAt
                ? new Date(lastSuccessfulSyncAt).toLocaleString()
                : t('sync.neverCompleted'),
            })}
          </Typography.Text>
          {lastSyncError && (
            <Typography.Text type="danger">
              {t('sync.failureKind', { kind: lastSyncError.kind })}
            </Typography.Text>
          )}
          <Button
            size="small"
            disabled={!isLoggedIn || !syncEnabled}
            onClick={() => syncEngine.retryNow()}
          >
            {t('sync.syncNow')}
          </Button>
        </Space>
      )}
      trigger="click"
    >
      <span
        className={`sync-status sync-status--${effectiveStatus}`}
      >
        <span className="sync-status__icon"><IconComponent /></span>
        <span className="sync-status__label">{label}</span>
      </span>
    </Popover>
  );
}

export default SyncStatusIndicator;
