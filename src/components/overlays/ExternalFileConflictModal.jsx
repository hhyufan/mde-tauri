import { Alert, Button, Modal, Space, Typography } from 'antd';

const { Paragraph, Text } = Typography;

function ExternalFileConflictModal({ conflict, onKeep, onUseDisk, onSaveAs }) {
  if (!conflict) return null;
  const unavailable = typeof conflict.diskContent !== 'string';
  return (
    <Modal
      open
      closable={false}
      maskClosable={false}
      title="文件已在外部发生变化"
      footer={(
        <Space wrap>
          <Button onClick={onKeep}>保留编辑内容</Button>
          <Button disabled={unavailable} onClick={onUseDisk}>采用磁盘内容</Button>
          <Button type="primary" onClick={onSaveAs}>另存为</Button>
        </Space>
      )}
    >
      <Alert
        type="warning"
        showIcon
        message={conflict.kind === 'removed' ? '原文件已被删除或移动' : '磁盘内容与本地编辑内容冲突'}
        description="MDE 没有覆盖任何一方，请明确选择要保留的版本。"
      />
      <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 16 }}>
        <Text type="secondary">{conflict.path}</Text>
      </Paragraph>
      {!unavailable && (
        <Text code style={{ whiteSpace: 'pre-wrap' }}>
          {(conflict.diskContent || '').slice(0, 400) || '（磁盘文件为空）'}
        </Text>
      )}
    </Modal>
  );
}

export default ExternalFileConflictModal;
