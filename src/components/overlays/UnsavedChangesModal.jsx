import { Modal, Button, Checkbox } from 'antd';
import { FileAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './unsaved-changes-modal.scss';

function UnsavedChangesModal({
  open,
  tabs = [],
  selectedTabIds = [],
  onToggleTab,
  onSaveSelected,
  onDiscard,
  onCancel,
  loading = false,
}) {
  const { t } = useTranslation();
  const selectedCount = selectedTabIds.length;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={t('unsaved.title')}
      footer={[
        <Button
          key="discard"
          className="unsaved-modal__discard"
          onClick={onDiscard}
          disabled={loading}
        >
          {t('unsaved.dontSave')}
        </Button>,
        <Button
          key="save"
          className="unsaved-modal__save"
          onClick={onSaveSelected}
          disabled={selectedCount === 0}
          loading={loading}
        >
          {t('unsaved.saveSelected', { count: selectedCount })}
        </Button>,
      ]}
      centered
      width={400}
      destroyOnHidden
      maskClosable={false}
      closable={!loading}
      rootClassName="mde-unsaved-modal-root"
      className="header-modal"
    >
      <div className="unsaved-modal">
        <p>{t('unsaved.message')}</p>
        <div className="unsaved-modal__file-list">
          {tabs.map((tab) => (
            <div key={tab.id} className="unsaved-modal__file-item">
              <Checkbox
                checked={selectedTabIds.includes(tab.id)}
                onChange={(event) => onToggleTab?.(tab, event.target.checked)}
              >
                {tab.name}
                {!tab.path && (
                  <FileAddOutlined className="unsaved-modal__temp-icon" />
                )}
              </Checkbox>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default UnsavedChangesModal;
