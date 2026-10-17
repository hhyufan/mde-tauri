import AppDialog from './AppDialog';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './delete-file-modal.scss';

export default function DeleteFileModal({ file, loading = false, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return <AppDialog
    open={Boolean(file)}
    title={t('sidebar.explorer.deleteTitle')}
    onCancel={onCancel}
    centered
    width={400}
    destroyOnHidden
    maskClosable={false}
    closable={!loading}
    keyboard={!loading}
    rootClassName="moki-delete-modal-root"
    footer={[
      <Button key="cancel" autoFocus disabled={loading} onClick={onCancel}>{t('sidebar.explorer.cancelDelete')}</Button>,
      <Button key="delete" danger type="primary" loading={loading} onClick={onConfirm}>{t('sidebar.explorer.confirmDelete')}</Button>,
    ]}
  >
    {file && <div className="delete-file-modal">
      <div className="delete-file-modal__file">
        <FileTypeIcon fileName={file.name} isFolder={file.is_dir} />
        <Tooltip title={file.path} placement="top" mouseEnterDelay={0.3}>
          <span>{file.name}</span>
        </Tooltip>
      </div>
      <p>{t('sidebar.explorer.deleteFileConfirm', { name: file.name })}</p>
    </div>}
  </AppDialog>;
}
