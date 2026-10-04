import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachMonacoLsp, completionItem, toRange, toPosition } from './monacoLsp';
import useLspStore from '@store/useLspStore';
import useProblemsStore, { collectProblems } from '@store/useProblemsStore';
import { invoke } from '@tauri-apps/api/core';

const mock = vi.hoisted(() => ({ connections: [], document: null, diagnostics: false, startPromise: null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./lspConnection', () => ({ LspConnection: class {
  constructor(onNotification, onExit, configuration) {
    Object.assign(this, { onNotification, onExit, configuration, closed: false });
    this.start = vi.fn(async () => mock.startPromise || mock.document || ({ uri: 'file:///test.py', rootUri: 'file:///', filePath: '/test.py' }));
    this.notify = vi.fn(async () => {});
    this.request = vi.fn(async (method) => method === 'initialize' ? { capabilities: {
      textDocumentSync: 2, completionProvider: {}, hoverProvider: true, definitionProvider: true,
      diagnosticProvider: mock.diagnostics ? {} : undefined,
    } } : method === 'textDocument/diagnostic' ? { kind: 'full', items: [
      { message: 'syntax error', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    ] } : { items: [{ label: 'print', kind: 3 }] });
    this.dispose = vi.fn(() => { this.closed = true; });
    mock.connections.push(this);
  }
} }));
let changed;
let monaco;
let model;
let providers;
let binding;
let providerDisposables;
beforeEach(() => {
  useProblemsStore.setState({ documents: {}, batches: {}, pendingJump: null });
  window.__TAURI_INTERNALS__ = {};
  useLspStore.setState({ enabled: true, installed: [{ enabled: true, manifest: { id: 'mde.pyright', languages: ['python'], args: [] } }], preferred: {}, statuses: {}, operations: {} });
  providers = {};
  providerDisposables = [];
  monaco = { editor: { setModelMarkers: vi.fn() }, MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    languages: { CompletionItemKind: { Text: 0, Function: 1 }, CompletionItemInsertTextRule: { InsertAsSnippet: 4 } },
    Uri: { parse: (value) => value } };
  for (const kind of ['CompletionItem', 'Hover', 'Definition', 'Reference', 'DocumentFormattingEdit', 'SignatureHelp']) {
    monaco.languages[`register${kind}Provider`] = vi.fn((_language, provider) => {
      providers[kind] = provider;
      const disposable = { dispose: vi.fn() }; providerDisposables.push(disposable); return disposable;
    });
  }
  model = { uri: { toString: () => 'inmemory://test' }, getLanguageId: () => 'python', getValue: () => 'print("🦀")',
    onDidChangeContent: (callback) => { changed = callback; return { dispose: vi.fn() }; },
    isDisposed: () => false, getWordUntilPosition: () => ({ startColumn: 1, endColumn: 3 }) };
  mock.connections.length = 0;
  mock.document = null;
  mock.diagnostics = false;
  mock.startPromise = null;
  invoke.mockReset();
});
afterEach(() => { binding?.dispose(); binding = null; vi.useRealTimers(); });
async function open() {
  binding = attachMonacoLsp(monaco, model, { name: 'test.py', path: '/test.py' });
  await vi.waitFor(() => expect(useLspStore.getState().statuses['mde.pyright']?.status).toBe('ready'));
  return mock.connections.at(-1);
}
it('converts UTF-16 ranges and LSP completion snippets and import edits', () => {
  expect(toPosition({ lineNumber: 2, column: 5 })).toEqual({ line: 1, character: 4 });
  const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } };
  expect(toRange(range).startColumn).toBe(2);
  const suggestion = completionItem(monaco, model, { lineNumber: 1, column: 3 }, {
    label: 'print', kind: 3, insertTextFormat: 2, textEdit: { range, newText: 'print($1)' },
    additionalTextEdits: [{ range, newText: 'import sys' }],
  });
  expect(suggestion).toMatchObject({ kind: 1, insertText: 'print($1)', insertTextRules: 4,
    range: { startColumn: 2 }, additionalTextEdits: [{ text: 'import sys' }] });
});
it('flushes unsaved edits before completion and uses one document version per change batch', async () => {
  const connection = await open();
  changed({ changes: [{ rangeOffset: 0, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x' }] });
  const result = await providers.CompletionItem.provideCompletionItems(model, { lineNumber: 1, column: 3 }, {}, {});
  expect(result.suggestions[0].label).toBe('print');
  const change = connection.notify.mock.calls.find(([method]) => method === 'textDocument/didChange');
  expect(change[1]).toMatchObject({ textDocument: { version: 2 }, contentChanges: [{ text: 'x', range: { start: { line: 0, character: 0 } } }] });
  expect(connection.notify.mock.invocationCallOrder.at(-1)).toBeLessThan(connection.request.mock.invocationCallOrder.at(-1));
});
it('drops stale diagnostics, isolates other models and clears markers on disposal', async () => {
  const connection = await open();
  const diagnostic = { message: 'bad', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
  connection.onNotification('textDocument/publishDiagnostics', { uri: 'file:///other.py', diagnostics: [diagnostic] });
  expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
  connection.onNotification('textDocument/publishDiagnostics', { uri: 'file:///test.py', version: 1, diagnostics: [diagnostic] });
  expect(monaco.editor.setModelMarkers.mock.calls.at(-1)[2][0]).toMatchObject({ severity: 8, startLineNumber: 1 });
  const count = monaco.editor.setModelMarkers.mock.calls.length;
  connection.onNotification('textDocument/publishDiagnostics', { uri: 'file:///test.py', version: 0, diagnostics: [diagnostic] });
  expect(monaco.editor.setModelMarkers).toHaveBeenCalledTimes(count);
  expect(await providers.Hover.provideHover({}, { lineNumber: 1, column: 1 })).toBeNull();
  binding.dispose();
  expect(connection.dispose).toHaveBeenCalled();
  expect(monaco.editor.setModelMarkers.mock.calls.at(-1)[2]).toEqual([]);
});
it('retains current-file diagnostics across disposal and replaces an empty diagnostic publication', async () => {
  const connection = await open();
  const diagnostic = { message: 'project warning', severity: 2, range: { start: { line: 7, character: 2 }, end: { line: 7, character: 5 } } };
  connection.onNotification('textDocument/publishDiagnostics', { uri: 'file:///test.py', diagnostics: [diagnostic] });
  expect(collectProblems(useProblemsStore.getState())).toMatchObject([{ filePath: '/test.py', line: 8, column: 3, severity: 2 }]);
  binding.dispose();
  expect(collectProblems(useProblemsStore.getState())).toHaveLength(1);
  // A future session's empty publication clears the corresponding file, not other files.
  binding = null;
  const next = await open();
  next.onNotification('textDocument/publishDiagnostics', { uri: 'file:///test.py', diagnostics: [] });
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
});
it('leaves providers untouched when disabled', () => {
  useLspStore.setState({ enabled: false });
  binding = attachMonacoLsp(monaco, model, { name: 'test.py' });
  expect(mock.connections).toHaveLength(0);
  expect(providers).toEqual({});
});
it.each(['global', 'plugin', 'removed'])('immediately revokes providers and late diagnostics when %s is disabled', async (action) => {
  const connection = await open();
  const diagnostic = { message: 'old diagnostic', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
  connection.onNotification('textDocument/publishDiagnostics', { uri: 'file:///test.py', diagnostics: [diagnostic] });
  if (action === 'global') useLspStore.getState().setEnabled(false);
  else if (action === 'plugin') {
    invoke.mockResolvedValueOnce(undefined);
    await useLspStore.getState().togglePlugin('mde.pyright', false);
  } else useLspStore.setState({ installed: [] });
  expect(connection.dispose).toHaveBeenCalledTimes(1);
  expect(providerDisposables.every((provider) => provider.dispose.mock.calls.length === 1)).toBe(true);
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
  connection.onNotification('textDocument/publishDiagnostics', { uri: 'file:///test.py', diagnostics: [diagnostic] });
  expect(monaco.editor.setModelMarkers.mock.calls.at(-1)[2]).toEqual([]);
  expect(collectProblems(useProblemsStore.getState())).toEqual([]);
  expect(await providers.CompletionItem.provideCompletionItems(model, { lineNumber: 1, column: 3 }, {}, {})).toEqual({ suggestions: [] });
});
it('cancels a binding that is disabled while the native server is starting', async () => {
  let complete;
  mock.startPromise = new Promise((resolve) => { complete = resolve; });
  binding = attachMonacoLsp(monaco, model, { name: 'test.py' });
  const connection = mock.connections[0];
  useLspStore.getState().setEnabled(false);
  complete({ uri: 'file:///test.py', rootUri: 'file:///' });
  await Promise.resolve(); await Promise.resolve();
  expect(connection.dispose).toHaveBeenCalledTimes(1);
  expect(connection.request).not.toHaveBeenCalled();
  expect(connection.notify).not.toHaveBeenCalled();
  expect(useLspStore.getState().statuses['mde.pyright'].status).toBe('idle');
});
it('drops an already-requested completion that arrives after disabling', async () => {
  const connection = await open();
  let complete;
  connection.request.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const completion = providers.CompletionItem.provideCompletionItems(model, { lineNumber: 1, column: 3 }, {}, {});
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  useLspStore.getState().setEnabled(false);
  complete({ items: [{ label: 'staleCompletion', kind: 3 }] });
  expect((await completion).suggestions).toEqual([]);
});
it('disables immediately even while the native command is pending and rolls back a failed disable', async () => {
  const connection = await open();
  let fail;
  invoke.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const disabling = useLspStore.getState().togglePlugin('mde.pyright', false);
  const failed = expect(disabling).rejects.toThrow('native failure');
  expect(connection.dispose).toHaveBeenCalledTimes(1);
  expect(useLspStore.getState().installed[0].enabled).toBe(false);
  expect(await providers.Hover.provideHover(model, { lineNumber: 1, column: 3 }, {})).toBeNull();
  fail(new Error('native failure')); await failed;
  expect(useLspStore.getState().installed[0].enabled).toBe(true);
  await open();
  expect(mock.connections).toHaveLength(2);
});
it('revokes an uninstalling plugin before native removal finishes and can reconnect after re-enabling', async () => {
  const connection = await open();
  let complete;
  invoke.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const removal = useLspStore.getState().uninstall('mde.pyright');
  expect(connection.dispose).toHaveBeenCalledTimes(1);
  const closed = attachMonacoLsp(monaco, model, { name: 'test.py' });
  expect(mock.connections).toHaveLength(1);
  closed.dispose();
  complete(); await removal;
  expect(useLspStore.getState().installed).toEqual([]);
  useLspStore.setState({ installed: [{ enabled: true, manifest: { id: 'mde.pyright', languages: ['python'] } }] });
  await open();
  expect(mock.connections).toHaveLength(2);
  expect((await providers.CompletionItem.provideCompletionItems(model, { lineNumber: 1, column: 3 }, {}, {})).suggestions[0].label).toBe('print');
});
it('pulls fresh diagnostics when a server finishes loading its workspace', async () => {
  mock.diagnostics = true;
  const connection = await open();
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(400);
  connection.request.mockClear();
  monaco.editor.setModelMarkers.mockClear();
  connection.onNotification('workspace/diagnostic/refresh');
  await vi.advanceTimersByTimeAsync(400);
  expect(connection.request).toHaveBeenCalledWith('textDocument/diagnostic', { textDocument: { uri: 'file:///test.py' } });
  expect(monaco.editor.setModelMarkers.mock.calls.at(-1)[2][0].message).toBe('syntax error');
});
it('uses backend Rust single-file project configuration instead of a source path as a manifest', async () => {
  model.getLanguageId = () => 'rust';
  useLspStore.setState({ installed: [{ enabled: true, manifest: { id: 'mde.rust', languages: ['rust'] } }] });
  const project = { sysroot: 'C:/Rust', crates: [{ root_module: 'C:/main.rs', edition: '2021', deps: [] }] };
  mock.document = { uri: 'file:///C:/main.rs', rootUri: 'file:///C:/', standalone: true,
    initializationOptions: { linkedProjects: [project] } };
  binding = attachMonacoLsp(monaco, model, { name: 'main.rs', path: 'C:/main.rs' });
  const connection = mock.connections[0];
  await vi.waitFor(() => expect(useLspStore.getState().statuses['mde.rust']?.status).toBe('ready'));
  const initialize = connection.request.mock.calls.find(([method]) => method === 'initialize');
  expect(initialize[1].initializationOptions.linkedProjects).toEqual([project]);
  const configuration = connection.notify.mock.calls.find(([method]) => method === 'workspace/didChangeConfiguration');
  expect(configuration[1].settings['rust-analyzer'].linkedProjects).toEqual([project]);
  binding.dispose();
});
