import { beforeEach, expect, it, vi } from 'vitest';
import useProblemsStore, { collectProblems } from '@store/useProblemsStore';
import { watchMonacoProblems } from './monacoProblems';
beforeEach(() => useProblemsStore.setState({ documents: {}, batches: {}, pendingJump: null }));
it('collects built-in Monaco markers, skips mirrored LSP markers and keeps disposed model results', () => {
  const uri = { toString: () => 'file:///test.js' };
  const model = { id: 'model', uri, getVersionId: () => 1, isDisposed: () => false };
  const marker = { owner: 'javascript', severity: 4, message: 'warning', startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 4 };
  let publish, edit;
  const dispose = vi.fn();
  const monaco = { editor: { onDidChangeMarkers: (callback) => { publish = callback; return { dispose }; },
    getModel: vi.fn(() => model), getModelMarkers: () => [marker, { ...marker, owner: 'lsp' }] } };
  const editor = { getModel: () => model, onDidChangeModelContent: (callback) => { edit = callback; return { dispose }; } };
  useProblemsStore.getState().registerDocument({ tabId: 'test', filePath: '/test.js', modelUri: uri.toString() });
  const watcher = watchMonacoProblems(monaco, editor);
  publish([uri]);
  expect(collectProblems(useProblemsStore.getState())).toMatchObject([{ severity: 2, line: 3, column: 2 }]);
  monaco.editor.getModel.mockReturnValue(null);
  publish([uri]);
  expect(collectProblems(useProblemsStore.getState())).toHaveLength(1);
  edit();
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
  watcher.dispose();
  expect(dispose).toHaveBeenCalledTimes(2);
});
