import { useTranslation } from 'react-i18next';
import TaskRing from './TaskRing';
import './task-status-indicator.scss';

// 进行中的阶段：检测更新、下载/安装/重启，以及语言服务的安装与卸载。
const activeStages = new Set([
  'checking',
  'downloading',
  'installing',
  'restarting',
  'preparing',
  'extracting',
  'uninstalling',
]);

export default function TaskStatusIndicator({ stage, label, progress, expanded, onClick }) {
  const { t } = useTranslation();
  const active = activeStages.has(stage);
  // label 由调用方给出（语言服务阶段用的是 languageServices.phase.* 文案），
  // 缺省时才回退到按 stage 推导的 tasks.* 文案。
  const text = label || (active ? t(`tasks.${stage}`) : t('tasks.title'));
  return (
    <button
      type="button"
      className={`task-status-indicator${active ? ' is-active' : ''}`}
      aria-label={text}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {active ? (
        <TaskRing progress={progress} />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M9 6h12M9 12h12M9 18h12M3 6h2M3 12h2M3 18h2" />
        </svg>
      )}
      <span>{text}</span>
    </button>
  );
}
