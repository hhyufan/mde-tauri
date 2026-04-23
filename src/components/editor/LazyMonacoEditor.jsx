import { lazy, Suspense, forwardRef } from 'react';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

const MonacoEditor = lazy(() => import('./MonacoEditor'));

function LoadingFallback() {
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
      <span>Loading editor…</span>
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
