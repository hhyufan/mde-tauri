import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Typography } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { flushEditorBuffer, getBuffer, subscribe } from '@utils/editorBuffer';
import MonacoConflictDiff from './MonacoConflictDiff';
import './conflict-dialog.scss';

const { Paragraph, Text } = Typography;

function ExternalFileConflictModal({ conflict, onKeep, onUseDisk, onSaveAs, onClose }) {
  const tab = useEditorStore((state) => state.tabs.find((item) => item.id === conflict?.tabId));
  const theme = useThemeStore((state) => state.theme);
  const { fontSize, fontFamily, lineHeight, tabSize } = useConfigStore();
  const [localContent, setLocalContent] = useState(() => getBuffer(conflict?.tabId, tab?.content || ''));
  useEffect(() => {
    if (!conflict?.tabId) return undefined;
    const update = () => setLocalContent(getBuffer(conflict.tabId, tab?.content || ''));
    flushEditorBuffer(conflict.tabId);
    update();
    return subscribe(update);
  }, [conflict?.tabId, tab?.content]);
  if (!conflict) return null;
  const unavailable = typeof conflict.diskContent !== 'string';
  /*
   * 宽度按内容定。只有「本地改动 vs 磁盘内容」的并排 diff 需要那么宽；
   * 「原文件已被删除或移动」没有 diff（下面 !unavailable 那段不渲染），
   * 内容只剩一条提示加一行路径，撑在 1180px 里会空得离谱。
   */
  const width = unavailable ? 'min(520px, 94vw)' : 'min(1180px, 94vw)';
  return (
    <Modal
      open
      width={width}
      centered
      destroyOnHidden
      rootClassName="moki-external-file-conflict-root"
      styles={{
        content: { padding: '20px 24px' },
        header: { padding: '0 32px 16px 0' },
        footer: { marginTop: 16 },
      }}
      onCancel={onClose}
      title="文件已在外部发生变化"
      footer={(
        <Space wrap>
          <Button onClick={onClose}>稍后处理</Button>
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
        description="MokiDown 没有覆盖任何一方，请明确选择要保留的版本。"
      />
      <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 16 }}>
        <Text type="secondary">{conflict.path}</Text>
      </Paragraph>
      {!unavailable && (
        <div className="conflict-dialog__diff external-file-conflict__diff">
          <MonacoConflictDiff
            original={localContent}
            modified={conflict.diskContent}
            fileName={conflict.path}
            localLabel="本地编辑内容"
            remoteLabel="磁盘内容"
            theme={theme}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
          />
        </div>
      )}
    </Modal>
  );
}

export default ExternalFileConflictModal;
