/**
 * Monaco ???????????
 *
 * ??????????????????????????????? Monaco ????????
 */
import { lazy, Suspense, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

// Monaco 实例创建前必须先完成语言与主题注册。生产构建的 chunk 求值顺序与 dev
// 不同，用统一门闩可以避免编辑器先用未定义的主题名创建出来，也不会出现先用
// 内置主题、随后再异步换肤的闪一下。
const MonacoEditor = lazy(() =>
  import('@/utils/monacoRuntimeBoot')
    .then(({ prepareMonacoRuntime }) => prepareMonacoRuntime())
    .then(() => import('./MonacoEditor'))
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
