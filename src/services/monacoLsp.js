import { LspConnection } from './lspConnection';
import useLspStore, { selectLanguagePlugin } from '@store/useLspStore';
import useProblemsStore, { problemDocumentKey } from '@store/useProblemsStore';
import { disableBundledLanguageServices } from './monacoLanguageServices';

export const toPosition = ({ lineNumber, column }) => ({ line: lineNumber - 1, character: column - 1 });
export const toRange = (range) => ({
  startLineNumber: range.start.line + 1, startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1, endColumn: range.end.character + 1,
});
const contents = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => ({
  value: typeof item === 'string' ? item : item.language ? `\`\`\`${item.language}\n${item.value}\n\`\`\`` : item.value,
  isTrusted: false,
}));
const dynamicCapabilities = {
  'textDocument/completion': 'completionProvider', 'textDocument/hover': 'hoverProvider',
  'textDocument/definition': 'definitionProvider', 'textDocument/references': 'referencesProvider',
  'textDocument/signatureHelp': 'signatureHelpProvider', 'textDocument/formatting': 'documentFormattingProvider',
};

export function completionItem(monaco, model, position, item, defaults = {}) {
  const word = model.getWordUntilPosition(position);
  const edit = item.textEdit;
  const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
    startColumn: word.startColumn, endColumn: word.endColumn };
  const range = edit?.range || edit?.replace || defaults.editRange?.replace || defaults.editRange;
  // LSP and Monaco use different enum orderings.
  const kinds = ['Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface',
    'Module', 'Property', 'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference',
    'Folder', 'EnumMember', 'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter'];
  return {
    label: item.label, detail: item.detail,
    kind: monaco.languages.CompletionItemKind[kinds[(item.kind || 1) - 1]] ?? monaco.languages.CompletionItemKind.Text,
    documentation: contents(item.documentation)[0],
    insertText: edit?.newText ?? item.textEditText ?? item.insertText ?? item.label,
    insertTextRules: (item.insertTextFormat ?? defaults.insertTextFormat) === 2
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range: range ? toRange(range) : fallback,
    sortText: item.sortText, filterText: item.filterText,
    commitCharacters: item.commitCharacters ?? defaults.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map((edit) => ({ range: toRange(edit.range), text: edit.newText })),
    preselect: item.preselect,
  };
}

/** Bind the active Monaco model to one local server; providers are disposed with it. */
export function attachMonacoLsp(monaco, model, tab) {
  disableBundledLanguageServices(monaco);
  const store = useLspStore.getState();
  const language = model.getLanguageId();
  const plugin = selectLanguagePlugin(store, language);
  if (!window.__TAURI_INTERNALS__ || !plugin) {
    return { dispose() {} };
  }
  const settings = plugin.manifest;
  const key = plugin.manifest.id;
  const setStatus = (status, message) => useLspStore.getState().setStatus(key, status, message);
  const providers = [];
  let disposed = false;
  let unwatch = () => {};
  let opened = false;
  let document;
  let capabilities = {};
  let version = 1;
  let diagnosticTimer;
  let changes = [];
  let flushTimer;
  let changeQueue = Promise.resolve();
  const configuration = language === 'rust' ? { checkOnSave: false, ...settings.configuration } : settings.configuration || {};
  const connection = new LspConnection((method, params) => {
    if (disposed) return;
    if (method === 'workspace/diagnostic/refresh' && opened) pullDiagnostics();
    if (method === 'window/showMessage' && params?.type === 1) setStatus('error', params.message);
    if (method === 'client/registerCapability') {
      for (const registration of params?.registrations || []) {
        const capability = dynamicCapabilities[registration.method];
        if (capability) capabilities[capability] = registration.registerOptions || true;
      }
    }
    if (method === 'textDocument/publishDiagnostics' && params?.uri === document?.uri && document) {
      if (params.version != null && params.version !== version) return;
      const metadata = { uri: model.uri.toString(), filePath: tab.path || '', tabId: tab.id, modelUri: model.uri.toString(),
        fileName: tab.name,
        rootUri: document.rootUri };
      useProblemsStore.getState().replace(`lsp:${key}`, metadata, params.diagnostics || [], connection.id, params.version);
      monaco.editor.setModelMarkers(model, 'lsp', (params.diagnostics || []).map((diagnostic) => ({
        ...toRange(diagnostic.range), message: diagnostic.message,
        severity: [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info,
          monaco.MarkerSeverity.Hint][(diagnostic.severity || 1) - 1],
        source: diagnostic.source, code: diagnostic.code != null ? String(diagnostic.code) : undefined,
        tags: diagnostic.tags,
      })));
    }
  }, (error) => {
    if (!disposed) {
      setStatus('error', error);
      monaco.editor.setModelMarkers(model, 'lsp', []);
    }
  }, configuration);

  function dispose(clearProblems = false) {
    if (disposed) return;
    disposed = true;
    unwatch();
    clearTimeout(flushTimer); clearTimeout(diagnosticTimer);
    changed.dispose(); providers.forEach((provider) => provider.dispose());
    if (!model.isDisposed()) monaco.editor.setModelMarkers(model, 'lsp', []);
    if (clearProblems) useProblemsStore.getState().clearOwner(`lsp:${key}`);
    connection.dispose();
    setStatus('idle');
  }

  function syncKind() {
    const sync = capabilities.textDocumentSync;
    return typeof sync === 'number' ? sync : sync?.change ?? 0;
  }
  function flush() {
    clearTimeout(flushTimer);
    if (!opened || disposed || !changes.length) return changeQueue;
    const contentChanges = syncKind() === 2 ? changes : [{ text: model.getValue() }];
    changes = [];
    if (!syncKind()) return changeQueue;
    const params = { textDocument: { uri: document.uri, version }, contentChanges };
    changeQueue = changeQueue.then(() => connection.notify('textDocument/didChange', params));
    // Observe failures even when a timer, rather than a provider, initiated the flush.
    changeQueue.catch((error) => { if (!disposed) setStatus('error', error.message); });
    return changeQueue;
  }
  function pullDiagnostics() {
    if (!capabilities.diagnosticProvider || disposed) return;
    clearTimeout(diagnosticTimer);
    diagnosticTimer = setTimeout(async () => {
      const currentVersion = version;
      try {
        await flush();
        const report = await connection.request('textDocument/diagnostic', { textDocument: { uri: document.uri } });
        if (report?.kind === 'full' && currentVersion === version) connection.onNotification('textDocument/publishDiagnostics', {
          uri: document.uri, version, diagnostics: report.items,
        });
      } catch (_) { /* A provider may be dynamically removed while a request is pending. */ }
    }, 350);
  }
  const changed = model.onDidChangeContent((event) => {
    version += 1;
    monaco.editor.setModelMarkers(model, 'lsp', []);
    useProblemsStore.getState().clearDocument(problemDocumentKey({ filePath: tab.path, tabId: tab.id }));
    // Monaco reports edits against the same original document; apply from the end.
    if (opened) changes.push(...[...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset).map((change) => ({
      range: { start: toPosition({ lineNumber: change.range.startLineNumber, column: change.range.startColumn }),
        end: toPosition({ lineNumber: change.range.endLineNumber, column: change.range.endColumn }) }, text: change.text,
    })));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 120);
    if (opened) pullDiagnostics();
  });
  // Revoke contributions synchronously, including while start/initialize is in flight.
  // Disposal must not depend on an editor component's delayed rebind or a native exit event.
  unwatch = useLspStore.subscribe((state) => {
    if (selectLanguagePlugin(state, language)?.manifest.id !== key) dispose(true);
  });

  const ready = (async () => {
    setStatus('starting');
    document = await connection.start({ language, pluginId: key, filePath: tab.path || null, fileName: tab.name,
      source: model.getValue() });
    if (disposed) return;
    useProblemsStore.getState().registerDocument({ uri: model.uri.toString(), modelUri: model.uri.toString(),
      filePath: tab.path || '', tabId: tab.id, fileName: tab.name, rootUri: document.rootUri });
    Object.assign(configuration, document.initializationOptions || {});
    const result = await connection.request('initialize', {
      processId: null, clientInfo: { name: 'MDE', version: '0.1.0' },
      rootUri: document.rootUri, workspaceFolders: [{ uri: document.rootUri, name: 'workspace' }],
      initializationOptions: configuration,
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: { configuration: true, workspaceFolders: true, applyEdit: false,
          diagnostics: { refreshSupport: true } },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          completion: { dynamicRegistration: true, completionItem: { snippetSupport: true,
            documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: false },
          },
          hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
          definition: { dynamicRegistration: true, linkSupport: true },
          references: { dynamicRegistration: true },
          formatting: { dynamicRegistration: true },
          signatureHelp: { dynamicRegistration: true, signatureInformation: { documentationFormat: ['markdown', 'plaintext'],
            parameterInformation: { labelOffsetSupport: true } } },
          publishDiagnostics: { versionSupport: true, tagSupport: { valueSet: [1, 2] } },
          diagnostic: { dynamicRegistration: false },
        },
        window: { workDoneProgress: true },
      },
    }, null, 60000);
    if (disposed) return;
    capabilities = { ...capabilities, ...result.capabilities };
    if (capabilities.positionEncoding && capabilities.positionEncoding !== 'utf-16') throw new Error('Language server must support UTF-16 positions');
    await connection.notify('initialized', {});
    await connection.notify('workspace/didChangeConfiguration', { settings: language === 'rust' ? { 'rust-analyzer': configuration } : configuration });
    const opening = connection.notify('textDocument/didOpen', { textDocument: { uri: document.uri, languageId: language, version,
      text: model.getValue() } });
    opened = true;
    await opening;
    if (disposed) return;
    setStatus('ready');
    pullDiagnostics();
  })().catch((error) => {
    if (!disposed) {
      if (useLspStore.getState().statuses[key]?.status !== 'error') setStatus('error', String(error?.message || error));
      connection.dispose();
    }
  });

  async function request(capability, method, position, extra, token) {
    await ready;
    if (disposed || !opened || connection.closed || !capabilities[capability] || token?.isCancellationRequested) return null;
    await flush();
    const requestedVersion = version;
    const result = await connection.request(method, { textDocument: { uri: document.uri },
      ...(position ? { position: toPosition(position) } : {}), ...extra }, token);
    return disposed || requestedVersion !== version || token?.isCancellationRequested ? null : result;
  }
  const guard = (fallback, callback) => async (...args) => {
    if (args[0] !== model || disposed) return fallback;
    try { return await callback(...args); } catch (_) { return fallback; }
  };
  providers.push(monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', ':', '<', '"', "'", '/', '@'],
    provideCompletionItems: guard({ suggestions: [] }, async (model, position, _context, token) => {
      const result = await request('completionProvider', 'textDocument/completion', position, { context: { triggerKind: 1 } }, token);
      return { suggestions: (Array.isArray(result) ? result : result?.items || []).map((item) => completionItem(monaco, model, position, item, result?.itemDefaults)),
        incomplete: Boolean(result?.isIncomplete) };
    }),
  }));
  providers.push(monaco.languages.registerHoverProvider(language, {
    provideHover: guard(null, async (_model, position, token) => {
      const result = await request('hoverProvider', 'textDocument/hover', position, {}, token);
      return result ? { contents: contents(result.contents), ...(result.range ? { range: toRange(result.range) } : {}) } : null;
    }),
  }));
  function locations(result) {
    return (Array.isArray(result) ? result : result ? [result] : []).map((location) => ({
      uri: monaco.Uri.parse((location.targetUri || location.uri) === document.uri ? model.uri.toString() : location.targetUri || location.uri),
      range: toRange(location.targetSelectionRange || location.range),
    }));
  }
  providers.push(monaco.languages.registerDefinitionProvider(language, {
    provideDefinition: guard(null, async (_model, position, token) => locations(await request('definitionProvider', 'textDocument/definition', position, {}, token))),
  }));
  providers.push(monaco.languages.registerReferenceProvider(language, {
    provideReferences: guard([], async (_model, position, context, token) => locations(await request('referencesProvider', 'textDocument/references', position, { context }, token))),
  }));
  providers.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
    provideDocumentFormattingEdits: guard([], async (_model, options, token) => {
      const result = await request('documentFormattingProvider', 'textDocument/formatting', null, { options }, token);
      return (result || []).map((edit) => ({ range: toRange(edit.range), text: edit.newText }));
    }),
  }));
  providers.push(monaco.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [')'],
    provideSignatureHelp: guard(null, async (_model, position, token) => {
      const result = await request('signatureHelpProvider', 'textDocument/signatureHelp', position, {}, token);
      if (!result) return null;
      return { value: { ...result, activeSignature: result.activeSignature || 0, activeParameter: result.activeParameter || 0,
        signatures: result.signatures.map((signature) => ({ ...signature, documentation: contents(signature.documentation)[0],
          parameters: (signature.parameters || []).map((parameter) => ({ ...parameter, documentation: contents(parameter.documentation)[0] })) })) }, dispose() {} };
    }),
  }));
  return {
    async save() {
      await ready;
      const save = typeof capabilities.textDocumentSync === 'object' && capabilities.textDocumentSync.save;
      if (disposed || !opened || !save) return;
      try { await flush(); await connection.notify('textDocument/didSave', { textDocument: { uri: document.uri }, ...(save.includeText ? { text: model.getValue() } : {}) }); }
      catch (_) { /* A save remains successful if the server has stopped. */ }
    },
    dispose: () => dispose(),
  };
}
