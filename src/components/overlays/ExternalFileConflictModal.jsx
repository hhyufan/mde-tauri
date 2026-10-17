import AppDialog from './AppDialog';
import { useEffect, useState } from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { flushEditorBuffer, getBuffer, subscribe } from '@utils/editorBuffer';
import MonacoConflictDiff from './MonacoConflictDiff';
import './conflict-dialog.scss';
import i18n from '@/i18n';

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
    <AppDialog
      open
      width={width}
      centered
      destroyOnHidden
      rootClassName="moki-external-file-conflict-root"
      onCancel={onClose}
      title={i18n.t('sync.conflict.changedTitle')}
      footer={(
        <Space wrap>
          <Button onClick={onClose}>{i18n.t('sync.conflict.later')}</Button>
          <Button onClick={onKeep}>{i18n.t('sync.conflict.keepEdits')}</Button>
          <Button disabled={unavailable} onClick={onUseDisk}>{i18n.t('sync.conflict.useDisk')}</Button>
          <Button type="primary" onClick={onSaveAs}>{i18n.t('sync.conflict.saveAs')}</Button>
        </Space>
      )}
    >
      <Alert
        type="warning"
        showIcon
        message={conflict.kind === 'removed' ? i18n.t('sync.conflict.removedMessage') : i18n.t('sync.conflict.changedMessage')}
        description={i18n.t('sync.conflict.changedHint')}
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
            localLabel={i18n.t('sync.conflict.local')}
            remoteLabel={i18n.t('sync.conflict.remote')}
            theme={theme}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
          />
        </div>
      )}
    </AppDialog>
  );
}

export default ExternalFileConflictModal;
