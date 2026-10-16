import { useEffect, useMemo, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';
import useUpdateStore from '@store/useUpdateStore';
import useLspStore from '@store/useLspStore';
import useEditorStore from '@store/useEditorStore';
import useTasks, { BUSY_PHASES } from '@hooks/useTasks';
import './task-list.scss';

// Non-modal Task List, following UI/md-editor.html's task-panel component.
export default function TaskList() {
  const { t } = useTranslation();
  const update = useUpdateStore();
  const operations = useLspStore((s) => s.operations);
  const { tasks } = useTasks();
  const hasUnsaved = useEditorStore((s) => s.tabRenderList.some((tab) => tab.modified));
  const [currentVersion, setCurrentVersion] = useState('');
  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch(() => {});
    void useUpdateStore.getState().check({ startup: true });
  }, []);

  const versionRow = useMemo(
    () =>
      update.stage === 'available' && currentVersion
        ? `v${currentVersion} → v${update.version}`
        : '',
    [update.stage, update.version, currentVersion],
  );

  // 面板的展开只由用户点击状态栏触发（showTasks），没有任何"自动弹出来"的路径。
  if (!update.open) return null;

  return (
    <section className="task-panel" aria-label={t('tasks.title')}>
      <div className="task-header">
        <h3>{tasks.length ? t('tasks.title') : t('tasks.empty')}</h3>
        <button type="button" aria-label={t('tasks.hide')} onClick={update.dismiss}>
          &times;
        </button>
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <div className="task-item" key={`${task.kind}-${task.id}`}>
            <div className="ti-row">
              <span className="ti-name">
                {task.name}
                {task.kind === 'update' && task.version ? ` · v${task.version}` : ''}
              </span>
              {task.showBar && task.percent !== undefined && (
                <span className="ti-pct">{task.percent}%</span>
              )}
            </div>
            <p className="task-status" role="status">
              {task.status}
            </p>
            {task.showBar && (
              <div
                className={`task-bar${task.percent === undefined ? ' is-indeterminate' : ''}`}
                role="progressbar"
                aria-label={task.name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={task.percent}
              >
                <div className="fill" style={{ width: `${task.percent ?? 35}%` }} />
              </div>
            )}
            {task.meta && <div className="task-meta">{task.meta}</div>}
            {task.kind === 'update' && versionRow && <div className="task-meta">{versionRow}</div>}

            {task.kind === 'update' && update.stage === 'available' && (
              <>
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

            {task.error && (
              <p className="task-error" role="alert">
                {task.error}
              </p>
            )}

            {task.kind === 'update' && update.stage === 'error' && (
              <div className="task-actions">
                <button type="button" className="task-primary" onClick={() => update.check()}>
                  {t('update.retry')}
                </button>
              </div>
            )}

            {task.kind === 'plugin' && BUSY_PHASES.has(operations?.[task.id]?.phase) && (
              <div className="task-actions">
                <button type="button" onClick={() => useLspStore.getState().cancelInstall(task.id)}>
                  {t('languageServices.cancel')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
