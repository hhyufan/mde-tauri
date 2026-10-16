import './task-ring.scss';

const RADIUS = 9;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 圆环进度：有确定百分比时画进度弧，没有时画一段固定弧并整体旋转。
 *
 * 状态栏指示器与语言服务列表共用同一个组件，保证两处的观感一致。
 * 轨道用 currentColor 加透明度，因此在明暗两种主题下都看得见
 * （早先写死 --border-light，暗色下几乎与背景同色）。
 *
 * @param {{ progress?: number, className?: string }} props 0-100；未提供或非有限值即为不确定进度
 */
export default function TaskRing({ progress, className = '' }) {
  const determinate = Number.isFinite(progress);
  const value = determinate ? Math.max(0, Math.min(100, progress)) : 0;
  return (
    <svg
      className={`task-ring${determinate ? '' : ' is-indeterminate'}${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      role={determinate ? 'progressbar' : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(value) : undefined}
      aria-hidden={determinate ? undefined : 'true'}
    >
      <circle className="task-ring__track" cx="12" cy="12" r={RADIUS} />
      <circle
        className="task-ring__value"
        cx="12"
        cy="12"
        r={RADIUS}
        transform="rotate(-90 12 12)"
        strokeDasharray={RING_CIRCUMFERENCE}
        // 不确定进度留出 28% 的空缺，配合旋转就是"转圈"；确定进度按比例收缩。
        strokeDashoffset={
          determinate ? RING_CIRCUMFERENCE * (1 - value / 100) : RING_CIRCUMFERENCE * 0.72
        }
      />
    </svg>
  );
}
