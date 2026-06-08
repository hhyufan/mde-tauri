/**
 * Monaco ???????????
 *
 * ??????????????????????????????? Monaco ????????
 */
import { lazy, Suspense, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

// 必须先执行 `monacoLocaleBoot`，再求值 `monaco-editor`。
// 原因是 Monaco 会在模块顶层缓存本地化文案，所以这里把启动模块串到
// 动态导入链最前面，让它和 Monaco 共享同一个懒加载边界：
// 只有在编辑器真正即将挂载时才初始化语言，而不是在应用启动时提前加载。
const MonacoEditor = lazy(() =>
  import('@/utils/monacoLocaleBoot').then(() => import('./MonacoEditor'))
);

/**
 * Monaco ????????????????
 */
function LoadingFallback() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-sec)',
        fontSize: 13,
        gap: 8,
      }}
    >
      <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} />
      <span>{t('editor.loading')}</span>
    </div>
  );
}

/**
 * ??? Monaco ??????????? ref?
 */
const LazyMonacoEditor = forwardRef(function LazyMonacoEditor(props, ref) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <MonacoEditor ref={ref} {...props} />
    </Suspense>
  );
});

export default LazyMonacoEditor;
