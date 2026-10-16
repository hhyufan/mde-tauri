import { useTranslation } from 'react-i18next';
import './task-status-indicator.scss';

// checking 也要算"进行中"：右下角那个指示器要显示"正在检测更新"，
// 而不是回退成通用标题。
const activeStages = new Set(['checking', 'downloading', 'installing', 'restarting']);

export default function TaskStatusIndicator({ stage, expanded, onClick }) {
  const { t } = useTranslation();
  const active = activeStages.has(stage);
  const label = active ? t(`tasks.${stage}`) : t('tasks.title');
  return (
    <button
      type="button"
      className={`task-status-indicator${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {active ? (
        <svg
          className="task-status-indicator__spinner"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
        </svg>
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
      <span>{label}</span>
    </button>
  );
}
