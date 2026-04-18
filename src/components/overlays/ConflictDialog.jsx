import { useTranslation } from 'react-i18next';
import './conflict-dialog.scss';

function ConflictDialog({ open, conflicts, onResolve, onClose }) {
  const { t } = useTranslation();
  if (!open || !conflicts?.length) return null;

  const current = conflicts[0];

  return (
    <div className="conflict-overlay" onClick={onClose}>
      <div className="conflict-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t('sync.conflict.title')}</h2>
        <p className="conflict-dialog__path">{current.relativePath}</p>

        <div className="conflict-dialog__panels">
          <div className="conflict-dialog__panel">
            <h3>{t('sync.conflict.local')}</h3>
            <pre>{current.localContent?.slice(0, 500)}</pre>
          </div>
          <div className="conflict-dialog__panel">
            <h3>{t('sync.conflict.remote')}</h3>
            <pre>{current.remoteContent?.slice(0, 500)}</pre>
          </div>
        </div>

        <div className="conflict-dialog__actions">
          <button className="conflict-dialog__btn" onClick={() => onResolve(current.relativePath, 'local')}>
            {t('sync.conflict.keepLocal')}
          </button>
          <button className="conflict-dialog__btn conflict-dialog__btn--primary" onClick={() => onResolve(current.relativePath, 'remote')}>
            {t('sync.conflict.useRemote')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConflictDialog;
