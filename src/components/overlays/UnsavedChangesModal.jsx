import { Modal, Button, Checkbox } from 'antd';
import { FileAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './unsaved-changes-modal.scss';

/**
 * 未保存变更确认弹窗。
 * 用于在关闭窗口、切换上下文等场景下集中列出仍有修改的标签页，
 * 支持用户勾选需要保存的文件，并在保存、放弃或取消之间做出选择。
 */
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
        // 放弃保存直接继续后续操作，但在保存流程进行中禁止误触。
        <Button
          key="discard"
          className="unsaved-modal__discard"
          onClick={onDiscard}
          disabled={loading}
        >
          {t('unsaved.dontSave')}
        </Button>,
        // 仅在至少选中一个文件时允许保存，按钮文案同步反映当前选择数量。
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
          {/* 逐项列出未保存标签页，便于用户精确选择本次要处理的文件。 */}
          {tabs.map((tab) => (
            <div key={tab.id} className="unsaved-modal__file-item">
              <Checkbox
                checked={selectedTabIds.includes(tab.id)}
                onChange={(event) => onToggleTab?.(tab, event.target.checked)}
              >
                {tab.name}
                {/* 无持久化路径的临时文件用图标标记，帮助用户快速辨识。 */}
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
