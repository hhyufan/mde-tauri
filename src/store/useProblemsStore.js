import { create } from 'zustand';

export function diagnosticPath(uri = '') {
  uri = String(uri || '');
  if (!uri.startsWith('file:')) return uri;
  try {
    const url = new URL(uri);
    const path = decodeURIComponent(url.pathname);
    return url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${path}` : path.replace(/^\/([a-z]:\/)/i, '$1');
  } catch (_) { return uri; }
}
export function problemPathKey(value = '') {
  let path = diagnosticPath(value).replace(/\\/g, '/');
  if (path.length > 1 && !/^[a-z]:\/$/i.test(path)) path = path.replace(/\/$/, '');
  return /^(?:[a-z]:\/|\/\/)/i.test(path) ? path.toLowerCase() : path;
}
export function problemDocumentKey(document) {
  return document.filePath ? problemPathKey(document.filePath) : document.tabId ? `tab:${document.tabId}` : problemPathKey(document.uri);
}
const useProblemsStore = create((set) => ({
  documents: {}, batches: {}, pendingJump: null,
  registerDocument: (document) => set((state) => {
    const key = problemDocumentKey(document);
    const documents = { ...state.documents, [key]: { ...state.documents[key], ...document, key } };
    const batches = { ...state.batches };
    // A saved/renamed untitled tab must not leave diagnostics under its old identity.
    for (const [oldKey, old] of Object.entries(documents)) {
      if (oldKey !== key && document.tabId && old.tabId === document.tabId) {
        delete documents[oldKey];
        for (const [id, batch] of Object.entries(batches)) if (batch.key === oldKey) delete batches[id];
      }
    }
    return { documents, batches };
  }),
  replace: (owner, document, diagnostics, generation, version) => set((state) => {
    const key = problemDocumentKey(document), id = JSON.stringify([owner, key]);
    const previous = state.batches[id];
    if (generation === previous?.generation && version != null && previous?.version > version) return state;
    return {
      documents: { ...state.documents, [key]: { ...state.documents[key], ...document, key } },
      batches: { ...state.batches, [id]: { owner, key, generation, version, diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic, severity: [1, 2, 3, 4].includes(diagnostic.severity) ? diagnostic.severity : 1,
      })) } },
    };
  }),
  clearDocument: (key) => set((state) => Object.values(state.batches).some((batch) => batch.key === key) ?
    { batches: Object.fromEntries(Object.entries(state.batches).filter(([, batch]) => batch.key !== key)) } : state),
  clearOwner: (owner) => set((state) => ({ batches: Object.fromEntries(Object.entries(state.batches).filter(([, batch]) => owner === 'lsp' ? !batch.owner.startsWith('lsp:') : batch.owner !== owner)) })),
  forgetDocument: (key) => set((state) => ({
    documents: Object.fromEntries(Object.entries(state.documents).filter(([id]) => id !== key)),
    batches: Object.fromEntries(Object.entries(state.batches).filter(([, batch]) => batch.key !== key)),
  })),
  requestJump: (jump) => set({ pendingJump: { ...jump, token: crypto.randomUUID() } }),
  finishJump: (token) => set((state) => state.pendingJump?.token === token ? { pendingJump: null } : state),
}));

export function collectProblems(state) {
  const problems = new Map();
  for (const batch of Object.values(state.batches)) {
    const document = state.documents[batch.key];
    if (!document) continue;
    for (const diagnostic of batch.diagnostics) {
      if (!diagnostic.range || !diagnostic.message) continue;
      const id = JSON.stringify([batch.key, diagnostic.range, diagnostic.severity, diagnostic.message, diagnostic.source || '', diagnostic.code ?? '']);
      problems.set(id, { ...document, ...diagnostic, id, line: diagnostic.range.start.line + 1, column: diagnostic.range.start.character + 1 });
    }
  }
  return [...problems.values()].sort((a, b) => a.severity - b.severity || a.key.localeCompare(b.key) || a.line - b.line || a.column - b.column || a.message.localeCompare(b.message));
}
export function selectFileProblems(state, active) {
  const key = active ? problemDocumentKey({ filePath: active.path, tabId: active.id }) : '';
  return collectProblems(state).filter((problem) => problem.key === key);
}
export default useProblemsStore;
