import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useUpdateStore from '@store/useUpdateStore';
import useLspStore, { availablePlugins } from '@store/useLspStore';

const MB = 1048576;

// 与 LanguageServices 的 BUSY 保持一致：这些阶段算"正在进行"。
export const BUSY_PHASES = new Set([
  'preparing',
  'downloading',
  'extracting',
  'installing',
  'uninstalling',
]);
// 更新流程里带进度条（可能带百分比）的阶段。
export const TRANSFER_STAGES = new Set(['downloading', 'installing', 'restarting']);
// 更新流程里算"进行中"的阶段。
const ACTIVE_STAGES = new Set(['checking', 'downloading', 'installing', 'restarting']);
// 状态栏需要露出提示、但并非进行中的阶段。
const NOTICE_STAGES = new Set(['available', 'error']);

/**
 * 全局任务清单：更新与语言服务安装/卸载统一成同一形状。
 *
 * 状态栏指示器与任务列表面板共用这里的结果，避免两处各自推导而慢慢漂移。
 * 形状：{ kind, id, name, status, stage, percent?, showBar, meta, error, version? }
 *  - stage 用于状态栏判断"进行中"以及回退文案；
 *  - percent 有确定值才画确定进度，否则是不确定进度（圆环转圈 / 条纹滑动）。
 *
 * @returns {{ tasks: object[], active: object|null }} active 是状态栏该显示的那一条
 */
export default function useTasks() {
  const { t } = useTranslation();
  const stage = useUpdateStore((s) => s.stage);
  const version = useUpdateStore((s) => s.version);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const total = useUpdateStore((s) => s.total);
  const updateError = useUpdateStore((s) => s.error);
  const operations = useLspStore((s) => s.operations);

  const tasks = useMemo(() => {
    const list = [];

    if (stage !== 'idle') {
      const percent =
        stage === 'downloading'
          ? total > 0
            ? Math.min(100, Math.floor((downloaded / total) * 100))
            : undefined
          : stage === 'restarting'
            ? 100
            : undefined;
      list.push({
        kind: 'update',
        id: 'update',
        stage,
        version,
        name: t('update.title'),
        status: t(`update.${stage}`, { version }),
        percent: TRANSFER_STAGES.has(stage) ? percent : undefined,
        showBar: TRANSFER_STAGES.has(stage),
        // 正在下载/安装/重启的更新中止不了（Tauri 的 downloadAndInstall 没有暴露
        // 中止入口），所以这些阶段不给关闭按钮；其余阶段关闭即回到空闲。
        close: ['available', 'error', 'up-to-date'].includes(stage) ? 'reset' : null,
        meta:
          stage === 'downloading'
            ? `${(downloaded / MB).toFixed(1)}${total > 0 ? ` / ${(total / MB).toFixed(1)}` : ''} MB`
            : '',
        error: updateError,
      });
    }

    const state = useLspStore.getState();
    const names = new Map();
    for (const plugin of availablePlugins(state)) names.set(plugin.id, plugin.name);
    for (const plugin of state.installed) {
      if (!names.has(plugin.manifest.id)) names.set(plugin.manifest.id, plugin.manifest.name);
    }
    for (const [id, operation] of Object.entries(operations || {})) {
      const busy = BUSY_PHASES.has(operation?.phase);
      if (!busy && operation?.phase !== 'error') continue;
      list.push({
        kind: 'plugin',
        id,
        stage: operation.phase,
        name: names.get(id) || id,
        // 失败态不能沿用"安装"这种动作文案，否则"安装"和下面的报错自相矛盾。
        status: busy
          ? t(`languageServices.phase.${operation.phase}`)
          : t('tasks.pluginFailed'),
        percent: busy && Number.isFinite(operation.percent) ? operation.percent : undefined,
        showBar: busy,
        // 进行中的安装可以真的取消；已经失败的只是把这条记录去掉。
        close: busy ? 'cancel' : 'dismiss',
        meta: busy ? operation.text || '' : '',
        error: operation.phase === 'error' ? operation.text || '' : '',
      });
    }

    return list;
  }, [stage, version, downloaded, total, updateError, operations, t]);

  const active = useMemo(() => {
    // 优先"正在进行"的：更新在前（它可能已经跑到下载/安装），其次是语言服务；
    // 都没有时退回可更新/失败这类需要露个脸的提示。
    const running =
      tasks.find((task) => task.kind === 'update' && ACTIVE_STAGES.has(task.stage)) ||
      tasks.find((task) => task.kind === 'plugin' && BUSY_PHASES.has(task.stage));
    if (running) return running;
    return tasks.find((task) => task.kind === 'update' && NOTICE_STAGES.has(task.stage)) || null;
  }, [tasks]);

  return { tasks, active };
}
