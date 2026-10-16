import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space } from 'antd';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';
import useUpdateStore from '@store/useUpdateStore';
import useEditorStore from '@store/useEditorStore';
import './update-dialog.scss';

const MB = 1048576;

export default function UpdateDialog() {
  const { t } = useTranslation();
  const update = useUpdateStore();
  const hasUnsaved = useEditorStore((s) => s.tabRenderList.some((tab) => tab.modified));
  // 当前版本要取运行时真实版本，不能用 package.json 里的 VITE_APP_VERSION：
  // dev 下 tauri.conf.json 与 package.json 的版本可能不一致（例如为了测更新把
  // conf 降到 0.1.2），拿 package.json 会把「0.1.3 → 0.1.3」这种错的对比显示出来。
  const [currentVersion, setCurrentVersion] = useState('');
  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);
  useEffect(() => {
    void useUpdateStore.getState().check({ startup: true });
  }, []);
  const working = ['checking', 'downloading', 'installing', 'restarting'].includes(update.stage);
  const percent =
    update.total > 0
      ? Math.min(100, Math.floor((update.downloaded / update.total) * 100))
      : undefined;
  const transfer = ['downloading', 'installing'].includes(update.stage);
  return (
    <Modal
      open={update.open}
      title={(
        <span className="update-dialog__title">
          <span className="update-dialog__mark">M</span>
          {t('update.title')}
        </span>
      )}
      onCancel={update.dismiss}
      closable={!working}
      maskClosable={!working}
      keyboard={!working}
      centered
      width={470}
      rootClassName="moki-update-modal-root"
      footer={(
        <Space>
          {!working && <Button onClick={update.dismiss}>{t('update.later')}</Button>}
          {update.stage === 'available' && (
            <Button type="primary" disabled={hasUnsaved} onClick={update.install}>
              {t('update.install')}
            </Button>
          )}
          {update.stage === 'error' && (
            <Button type="primary" onClick={() => update.check()}>
              {t('update.retry')}
            </Button>
          )}
        </Space>
      )}
    >
      <div className="update-dialog">
        {/* 有新版本时把「旧 → 新」摆出来，比一句话更有信息量 */}
        {update.stage === 'available' && update.version && (
          <div className="update-dialog__versions">
            {currentVersion && (
              <>
                <em>v{currentVersion}</em>
                <span>→</span>
              </>
            )}
            <b>v{update.version}</b>
          </div>
        )}
        <p className="update-dialog__status">
          {t(`update.${update.stage}`, { version: update.version })}
        </p>
        {update.stage === 'available' && (
          <>
            <p className="update-dialog__status">{t('update.consent')}</p>
            {update.body && <div className="update-dialog__notes">{update.body}</div>}
          </>
        )}
        {transfer && (
          <>
            <div
              className="update-dialog__track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? 0}
            >
              <div
                className={`update-dialog__fill${update.stage === 'downloading' ? ' is-active' : ''}`}
                style={{ width: `${percent ?? 100}%` }}
              />
            </div>
            <div className="update-dialog__meta">
              <span>
                {update.stage === 'downloading'
                  ? `${(update.downloaded / MB).toFixed(1)}${update.total > 0 ? ` / ${(update.total / MB).toFixed(1)}` : ''} MB`
                  : t('update.installing')}
              </span>
              {percent !== undefined && <span>{percent}%</span>}
            </div>
          </>
        )}
        {hasUnsaved && ['available', 'installed'].includes(update.stage) && (
          <Alert type="warning" showIcon message={t('update.saveFirst')} />
        )}
        {update.error && <Alert type="error" showIcon message={update.error} />}
      </div>
    </Modal>
  );
}
