import { lazy, Suspense, forwardRef } from 'react';

const MonacoEditor = lazy(() => import('./MonacoEditor'));

function LoadingFallback() {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-sec)',
      fontSize: 13,
    }}>
      Loading editor...
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
