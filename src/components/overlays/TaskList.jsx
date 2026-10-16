import { useEffect, useMemo, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';
import useUpdateStore from '@store/useUpdateStore';
import useLspStore from '@store/useLspStore';
import useEditorStore from '@store/useEditorStore';
import useTasks from '@hooks/useTasks';
import './task-list.scss';

// 关闭一条任务：进行中的安装是真取消，失败的只是把记录去掉，
// 更新则回到空闲并释放已拿到的更新资源。
function closeTask(task) {
  if (task.close === 'cancel') void useLspStore.getState().cancelInstall(task.id);
  else if (task.close === 'dismiss') useLspStore.getState().dismissOperation(task.id);
  else if (task.close === 'reset') void useUpdateStore.getState().reset();
}

// Non-modal Task List, following UI/md-editor.html's task-panel component.
export default function TaskList() {
  const { t } = useTranslation();
  const update = useUpdateStore();
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

  // 最后一条任务被关掉（或被取消）后面板自己收起，不留一个"没有进行中的任务"的空壳。
  // 必须放在下面的提前 return 之前，否则 Hooks 调用顺序会随 open 变化。
  const { open, dismiss } = update;
  useEffect(() => {
    if (open && tasks.length === 0) dismiss();
  }, [open, tasks.length, dismiss]);

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
        {tasks.map((task) => {
          // 数字进度那一行的左侧内容：下载量优先，其次是版本对比。
          const metaLeft = task.meta || (task.kind === 'update' ? versionRow : '');
          return (
            <div className="task-item" key={`${task.kind}-${task.id}`}>
              <div className="ti-row">
                <span className="ti-name">
                  {task.name}
                  {task.kind === 'update' && task.version ? ` · v${task.version}` : ''}
                </span>
                {task.close && (
                  <button
                    type="button"
                    className="task-close"
                    aria-label={`${t('tasks.closeTask')}：${task.name}`}
                    onClick={() => closeTask(task)}
                  >
                    &times;
                  </button>
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
            {(metaLeft || task.percent !== undefined) && (
              // 百分比与下载量同一行：数字在左，百分比贴右。
              <div className="task-meta-row">
                <span className="task-meta">{metaLeft}</span>
                {task.percent !== undefined && <span className="ti-pct">{task.percent}%</span>}
              </div>
            )}

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
          </div>
          );
        })}
      </div>
    </section>
  );
}
