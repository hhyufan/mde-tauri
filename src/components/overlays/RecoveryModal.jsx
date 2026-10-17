import AppDialog from './AppDialog';
import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Space, Typography } from 'antd';
import i18n from '@/i18n';

const { Paragraph } = Typography;

function RecoveryModal({ open, drafts, onRestore, onDiscard }) {
  const [selected, setSelected] = useState(() => new Set(drafts.map((draft) => draft.recoveryId)));
  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => selected.has(draft.recoveryId)),
    [drafts, selected],
  );

  const toggle = (id, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <AppDialog
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      width={720}
      title={i18n.t('unsaved.recoveryTitle')}
      footer={(
        <Space>
          <Button danger onClick={onDiscard}>{i18n.t('unsaved.discardAll')}</Button>
          <Button
            type="primary"
            disabled={selectedDrafts.length === 0}
            onClick={() => onRestore(selectedDrafts)}
          >
            {i18n.t('unsaved.restoreSelected', { count: selectedDrafts.length })}
          </Button>
        </Space>
      )}
    >
      <Alert
        type="warning"
        showIcon
        message={i18n.t('unsaved.recoveryMessage')}
        description={i18n.t('unsaved.recoveryHint')}
      />
      <div className="recovery-modal__list">
        {drafts.map((draft) => (
          <div key={draft.recoveryId} className="recovery-modal__draft">
            <Checkbox
              checked={selected.has(draft.recoveryId)}
              onChange={(event) => toggle(draft.recoveryId, event.target.checked)}
            >
              {draft.name}
            </Checkbox>
            <Paragraph className="recovery-modal__path" type="secondary" ellipsis={{ rows: 1 }}>
              {draft.path || i18n.t('unsaved.untitled')} · {draft.diskState === 'changed' ? i18n.t('unsaved.diskChanged') : draft.diskState === 'missing' ? i18n.t('unsaved.diskMissing') : i18n.t('unsaved.diskUnchanged')}
            </Paragraph>
            <pre className="recovery-modal__preview">
              {(draft.content || '').slice(0, 320) || i18n.t('unsaved.emptyDraft')}
            </pre>
          </div>
        ))}
      </div>
    </AppDialog>
  );
}

export default RecoveryModal;
