/** Monaco's startup preload and on-demand fallback share one loading task. */
import { lazy, Suspense, forwardRef, useRef } from 'react';
import { getLoadedMonacoEditor, preloadMonacoEditor } from '@utils/monacoRuntimeBoot';

const PendingMonacoEditor = lazy(preloadMonacoEditor);

const LazyMonacoEditor = forwardRef(function LazyMonacoEditor(props, ref) {
  // Keep the chosen type stable for this mount. Switching from React.lazy to
  // its resolved component on a later parent render would recreate Monaco and
  // drop keyboard focus, even though the document itself did not change.
  const editorType = useRef(getLoadedMonacoEditor() || PendingMonacoEditor);
  const Editor = editorType.current;
  return (
    <Suspense fallback={<div className={`monaco-editor-container ${props.className || ''}`} aria-busy="true" />}>
      <Editor ref={ref} {...props} />
    </Suspense>
  );
});

export default LazyMonacoEditor;
