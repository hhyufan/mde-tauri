import { useEffect } from 'react';
import { Alert, Button, Modal, Progress, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import useUpdateStore from '@store/useUpdateStore';
import useEditorStore from '@store/useEditorStore';

export default function UpdateDialog() {
  const { t } = useTranslation();
  const update = useUpdateStore();
  const hasUnsaved = useEditorStore((s) => s.tabRenderList.some((tab) => tab.modified));
  useEffect(() => {
    void useUpdateStore.getState().check({ startup: true });
  }, []);
  const working = ['checking', 'downloading', 'installing'].includes(update.stage);
  const percent =
    update.total > 0
      ? Math.min(100, Math.floor((update.downloaded / update.total) * 100))
      : undefined;
  return (
    <Modal
      open={update.open}
      title={t('update.title')}
      onCancel={update.dismiss}
      closable={!working}
      maskClosable={!working}
      keyboard={!working}
      footer={
        <Space>
          {!working && <Button onClick={update.dismiss}>{t('update.later')}</Button>}
          {update.stage === 'available' && (
            <Button type="primary" disabled={hasUnsaved} onClick={update.install}>
              {t('update.install')}
            </Button>
          )}
          {update.stage === 'installed' && (
            <Button type="primary" disabled={hasUnsaved} onClick={update.restart}>
              {t('update.restart')}
            </Button>
          )}
          {update.stage === 'error' && (
            <Button type="primary" onClick={() => update.check()}>
              {t('update.retry')}
            </Button>
          )}
        </Space>
      }
    >
      <p>{t(`update.${update.stage}`, { version: update.version })}</p>
      {update.stage === 'available' && (
        <>
          <p>{t('update.consent')}</p>
          {update.body && (
            <div
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 240,
                overflow: 'auto',
                overflowWrap: 'anywhere',
              }}
            >
              {update.body}
            </div>
          )}
        </>
      )}
      {['downloading', 'installing'].includes(update.stage) && (
        <>
          <Progress percent={percent} status="active" showInfo={percent !== undefined} />
          {update.stage === 'downloading' && (
            <p>
              {(update.downloaded / 1048576).toFixed(1)} MB
              {update.total > 0 ? ` / ${(update.total / 1048576).toFixed(1)} MB` : ''}
            </p>
          )}
        </>
      )}
      {hasUnsaved && ['available', 'installed'].includes(update.stage) && (
        <Alert type="warning" showIcon message={t('update.saveFirst')} />
      )}
      {update.error && <Alert type="error" showIcon message={update.error} />}
    </Modal>
  );
}
