import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Typography } from 'antd';

const { Paragraph, Text, Title } = Typography;

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
    <Modal
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      width={720}
      title="恢复未保存内容"
      footer={(
        <Space>
          <Button danger onClick={onDiscard}>全部丢弃</Button>
          <Button
            type="primary"
            disabled={selectedDrafts.length === 0}
            onClick={() => onRestore(selectedDrafts)}
          >
            恢复所选 ({selectedDrafts.length})
          </Button>
        </Space>
      )}
    >
      <Alert
        type="warning"
        showIcon
        message="检测到上次会话的未保存草稿"
        description="恢复只会重新打开为未保存标签，不会自动覆盖磁盘文件。"
      />
      <div style={{ maxHeight: 420, overflow: 'auto', marginTop: 16 }}>
        {drafts.map((draft) => (
          <div key={draft.recoveryId} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
            <Checkbox
              checked={selected.has(draft.recoveryId)}
              onChange={(event) => toggle(draft.recoveryId, event.target.checked)}
            >
              <Title level={5} style={{ display: 'inline', margin: 0 }}>{draft.name}</Title>
            </Checkbox>
            <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ margin: '6px 0' }}>
              {draft.path || '未命名文档'} · {draft.diskState === 'changed' ? '磁盘文件也已变化' : draft.diskState === 'missing' ? '原文件已不存在' : '磁盘文件未变化'}
            </Paragraph>
            <Text code style={{ whiteSpace: 'pre-wrap' }}>
              {(draft.content || '').slice(0, 320) || '（空白草稿）'}
            </Text>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default RecoveryModal;
