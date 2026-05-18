import { lazy, Suspense, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

// IMPORTANT: monacoLocaleBoot MUST run before `monaco-editor` is evaluated,
// because Monaco captures localized strings at module scope. Chain it in
// front of the dynamic import so it loads on the same code-split boundary
// as Monaco itself — i.e. only when the editor is actually about to mount,
// not at app startup.
const MonacoEditor = lazy(() =>
  import('@/utils/monacoLocaleBoot').then(() => import('./MonacoEditor'))
);

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

const LazyMonacoEditor = forwardRef(function LazyMonacoEditor(props, ref) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <MonacoEditor ref={ref} {...props} />
    </Suspense>
  );
});

export default LazyMonacoEditor;
