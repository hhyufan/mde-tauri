import { useTranslation } from 'react-i18next';
import { Modal, Button, Space } from 'antd';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import MonacoConflictDiff from './MonacoConflictDiff';
import './conflict-dialog.scss';

/**
 * 同步冲突弹窗。
 *
 * 每次展示一个冲突条目，并提供“保留本地”与“使用远端”两种显式决策入口。
 *
 * @param {object} props 组件属性。
 * @param {boolean} props.open 控制弹窗显示状态。
 * @param {Array<object>} props.conflicts 待处理的冲突列表。
 * @param {(fileId: string, decision: 'local' | 'remote') => void} props.onResolve 处理冲突决策的回调。
 * @param {() => void} props.onClose 关闭弹窗的回调。
 */
function ConflictDialog({ open, conflicts, onResolve, onClose }) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const fontFamily = useConfigStore((s) => s.fontFamily);
  const lineHeight = useConfigStore((s) => s.lineHeight);
  const tabSize = useConfigStore((s) => s.tabSize);
  if (!open || !conflicts?.length) return null;

  const current = conflicts[0];
  const localContent = current.localContent || '';
  const remoteContent = current.remoteContent || '';
  const pathLabel = current.path || current.name || current.fileId;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1180px, 94vw)"
      centered
      destroyOnHidden
      rootClassName="moki-conflict-modal-root"
      styles={{ body: { padding: 0 }, content: { padding: 0 } }}
    >
      <div className="conflict-dialog">
        <div className="conflict-dialog__header">
          <div className="conflict-dialog__title-wrap">
            <span className="conflict-dialog__eyebrow">Sync Conflict</span>
            <h2>{t('sync.conflict.title')}</h2>
            <p className="conflict-dialog__path">{pathLabel}</p>
          </div>
          <div className="conflict-dialog__header-right">
            <span className="conflict-dialog__hint">{t('sync.conflict.changesOnly')}</span>
          </div>
        </div>

        <div className="conflict-dialog__diff">
          <MonacoConflictDiff
            original={localContent}
            modified={remoteContent}
            fileName={current.name || current.path || ''}
            localLabel={t('sync.conflict.local')}
            remoteLabel={t('sync.conflict.remote')}
            theme={theme}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
          />
        </div>

        <div className="conflict-dialog__actions">
          <Space>
            <Button onClick={onClose}>{t('sync.conflict.later')}</Button>
            <Button onClick={() => onResolve(current.fileId, 'local')}>
              {t('sync.conflict.keepLocal')}
            </Button>
            <Button type="primary" onClick={() => onResolve(current.fileId, 'remote')}>
              {t('sync.conflict.useRemote')}
            </Button>
          </Space>
        </div>
      </div>
    </Modal>
  );
}

export default ConflictDialog;
