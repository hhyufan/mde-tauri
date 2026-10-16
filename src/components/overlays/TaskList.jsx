import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';
import useUpdateStore from '@store/useUpdateStore';
import useEditorStore from '@store/useEditorStore';
import './task-list.scss';

const MB = 1048576;

// Non-modal Task List, following UI/md-editor.html's task-panel component.
export default function TaskList() {
  const { t } = useTranslation();
  const update = useUpdateStore();
  const hasUnsaved = useEditorStore((s) => s.tabRenderList.some((tab) => tab.modified));
  const [currentVersion, setCurrentVersion] = useState('');
  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch(() => {});
    void useUpdateStore.getState().check({ startup: true });
  }, []);
  if (!update.open) return null;
  const transfer = ['downloading', 'installing', 'restarting'].includes(update.stage);
  const percent =
    update.stage === 'downloading'
      ? update.total > 0
        ? Math.min(100, Math.floor((update.downloaded / update.total) * 100))
        : undefined
      : update.stage === 'restarting'
        ? 100
        : undefined;
  return (
    <section className="task-panel" aria-label={t('tasks.title')}>
      <div className="task-header">
        <h3>{t('tasks.title')}</h3>
        <button type="button" aria-label={t('tasks.hide')} onClick={update.dismiss}>
          ×
        </button>
      </div>
      <div className="task-list">
        <div className="task-item">
          <div className="ti-row">
            <span className="ti-name">
              {t('update.title')}
              {update.version ? ` · v${update.version}` : ''}
            </span>
            {transfer && (
              <span className="ti-pct">{percent === undefined ? '…' : `${percent}%`}</span>
            )}
          </div>
          <p className="task-status" role="status">
            {t(`update.${update.stage}`, { version: update.version })}
          </p>
          {transfer && (
            <>
              <div
                className={`task-bar${percent === undefined ? ' is-indeterminate' : ''}`}
                role="progressbar"
                aria-label={t('update.title')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="fill" style={{ width: `${percent ?? 35}%` }} />
              </div>
              {update.stage === 'downloading' && (
                <div className="task-meta">
                  {(update.downloaded / MB).toFixed(1)}
                  {update.total > 0 ? ` / ${(update.total / MB).toFixed(1)}` : ''} MB
                </div>
              )}
            </>
          )}
          {update.stage === 'available' && (
            <>
              <div className="task-meta">
                {currentVersion ? `v${currentVersion} → v${update.version}` : `v${update.version}`}
              </div>
              {update.body && (
                <details className="task-notes">
                  <summary>{t('tasks.releaseNotes')}</summary>
                  <div>{update.body}</div>
                </details>
              )}
              <p className="task-hint">{t('update.consent')}</p>
              {hasUnsaved && (
                <p className="task-warning" role="status">
                  {t('update.saveFirst')}
                </p>
              )}
              <div className="task-actions">
                <button type="button" onClick={update.dismiss}>
                  {t('update.later')}
                </button>
                <button
                  type="button"
                  className="task-primary"
                  disabled={hasUnsaved}
                  onClick={update.install}
                >
                  {t('update.install')}
                </button>
              </div>
            </>
          )}
          {update.error && (
            <p className="task-error" role="alert">
              {update.error}
            </p>
          )}
          {update.stage === 'error' && (
            <div className="task-actions">
              <button type="button" className="task-primary" onClick={() => update.check()}>
                {t('update.retry')}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
