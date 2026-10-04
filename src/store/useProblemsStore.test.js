import { beforeEach, expect, it } from 'vitest';
import useProblemsStore, { collectProblems, selectFileProblems, diagnosticPath, problemPathKey } from './useProblemsStore';
const range = { start: { line: 4, character: 8 }, end: { line: 4, character: 10 } };
const document = { uri: 'file:///C:/Project/main.kt', filePath: 'C:\\Project\\main.kt', tabId: 'main', fileName: 'main.kt' };
beforeEach(() => useProblemsStore.setState({ documents: {}, batches: {}, pendingJump: null }));
it('aggregates and deduplicates levels, and replaces cleared diagnostics', () => {
  const problem = { range, message: 'missing symbol', severity: 1, source: 'kotlin' };
  useProblemsStore.getState().replace('lsp:kotlin', document, [problem, { ...problem, severity: 4, message: 'unused' }], 'session', 2);
  useProblemsStore.getState().replace('other', document, [problem]);
  expect(collectProblems(useProblemsStore.getState())).toHaveLength(2);
  expect(collectProblems(useProblemsStore.getState())[0]).toMatchObject({ line: 5, column: 9, severity: 1 });
  useProblemsStore.getState().replace('lsp:kotlin', document, [], 'session', 3);
  useProblemsStore.getState().clearOwner('other');
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
});
it('shows only the current file, with Windows URI/path equivalence', () => {
  const problem = { range, message: 'warning', severity: 2 };
  for (const file of ['main.kt', 'src/other.kt']) useProblemsStore.getState().replace('lsp:kotlin', {
    filePath: `C:/Project/${file}`, uri: `file:///C:/Project/${file}`,
  }, [problem]);
  useProblemsStore.getState().replace('lsp:kotlin', { filePath: 'C:/Project-other/main.kt' }, [problem]);
  const active = { id: 'main', path: 'c:\\PROJECT\\main.kt' };
  expect(selectFileProblems(useProblemsStore.getState(), active)).toHaveLength(1);
  expect(diagnosticPath('file:///C:/a%20b/%E4%B8%AD%E6%96%87.kt')).toBe('C:/a b/中文.kt');
  expect(problemPathKey('file://server/share/main.kt')).toBe('//server/share/main.kt');
});
it('rejects old versions within a session but accepts a restarted server at version one', () => {
  const state = useProblemsStore.getState();
  state.replace('lsp:kotlin', document, [{ range, message: 'current' }], 'session', 4);
  state.replace('lsp:kotlin', document, [{ range, message: 'old' }], 'session', 3);
  expect(collectProblems(useProblemsStore.getState())[0].message).toBe('current');
  state.replace('lsp:kotlin', document, [], 'new-session', 1);
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
});
it('maps unsaved documents to their tab and removes the old identity after save', () => {
  useProblemsStore.getState().replace('lsp:kotlin', { tabId: 'draft', uri: 'inmemory://draft', fileName: 'main.kt' }, [{ range, message: 'draft error' }]);
  expect(selectFileProblems(useProblemsStore.getState(), { id: 'draft', path: '' })).toHaveLength(1);
  useProblemsStore.getState().registerDocument({ tabId: 'draft', filePath: 'C:/Project/main.kt', fileName: 'main.kt' });
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
});
