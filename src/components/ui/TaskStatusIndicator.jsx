import { useTranslation } from 'react-i18next';
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

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 圆环进度：有确定百分比时画进度弧，没有时画一段固定弧并整体旋转。
 *
 * @param {{ progress?: number }} props 0-100；未提供或非有限值即为不确定进度
 */
function Ring({ progress }) {
  const determinate = Number.isFinite(progress);
  const value = determinate ? Math.max(0, Math.min(100, progress)) : 0;
  return (
    <svg
      className={`task-status-indicator__ring${determinate ? '' : ' is-indeterminate'}`}
      viewBox="0 0 24 24"
      role={determinate ? 'progressbar' : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(value) : undefined}
      aria-hidden={determinate ? undefined : 'true'}
    >
      <circle className="ring-track" cx="12" cy="12" r={RADIUS} />
      <circle
        className="ring-value"
        cx="12"
        cy="12"
        r={RADIUS}
        transform="rotate(-90 12 12)"
        strokeDasharray={CIRCUMFERENCE}
        // 不确定进度留出 28% 的空缺，配合旋转就是"转圈"；确定进度按比例收缩。
        strokeDashoffset={determinate ? CIRCUMFERENCE * (1 - value / 100) : CIRCUMFERENCE * 0.72}
      />
    </svg>
  );
}

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
        <Ring progress={progress} />
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
