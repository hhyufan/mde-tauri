import useProblemsStore, { problemDocumentKey } from '@store/useProblemsStore';

/** Retain detected problems when a tab/model is disposed, until the next validation replaces them. */
export function watchMonacoProblems(monaco, editor) {
  const publish = (resource) => {
    const model = monaco.editor.getModel(resource);
    if (!model || model.isDisposed()) return;
    const state = useProblemsStore.getState();
    const document = Object.values(state.documents).find((item) => item.modelUri === resource.toString());
    if (!document) return;
    const diagnostics = monaco.editor.getModelMarkers({ resource }).filter((marker) => marker.owner !== 'lsp').map((marker) => ({
      message: marker.message, severity: ({ 8: 1, 4: 2, 2: 3, 1: 4 })[marker.severity],
      source: marker.source || marker.owner, code: typeof marker.code === 'object' ? marker.code.value : marker.code,
      range: { start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
        end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 } },
    }));
    state.replace('monaco', document, diagnostics, model.id, model.getVersionId());
  };
  const markers = monaco.editor.onDidChangeMarkers((resources) => resources.forEach(publish));
  const content = editor.onDidChangeModelContent(() => {
    const model = editor.getModel();
    const document = Object.values(useProblemsStore.getState().documents).find((item) => item.modelUri === model?.uri.toString());
    if (document) useProblemsStore.getState().clearDocument(problemDocumentKey(document));
  });
  return { dispose() { markers.dispose(); content.dispose(); } };
}
