/**
 * 面包屑同款的圆角箭头。
 *
 * 目录面包屑、搜索范围选择器与本地历史折叠按钮共用这一枚字形，保证三处箭头
 * 的字重与圆角一致。字形默认指向右侧，需要朝下时由调用方通过样式旋转 90°。
 *
 * @param {{ className?: string, style?: import('react').CSSProperties }} props
 * @returns {JSX.Element} 箭头图标
 */
export default function ChevronIcon({ className, style }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path
        d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z"
        fill="currentColor"
      />
    </svg>
  );
}
