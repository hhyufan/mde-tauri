// View state is small and independent of document contents or React rendering.
const states = new Map();
const providers = new Set();
const listeners = new Set();

export const getDocumentViewState = (id, surface) => states.get(id)?.[surface];
export function setDocumentViewState(id, surface, value) {
  if (!id || !value) return;
  states.set(id, { ...states.get(id), [surface]: value });
  requestDocumentViewStateSave();
}
export function renameDocumentViewState(oldId, newId) {
  for (const provider of providers) if (provider.getId() === oldId) capture(provider);
  if (!states.has(oldId)) return;
  states.set(newId, states.get(oldId));
  states.delete(oldId);
}
export function requestDocumentViewStateSave() { listeners.forEach((listener) => listener()); }
export function subscribeDocumentViewState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function capture(provider) {
  try {
    const id = provider.getId();
    const value = provider.read();
    if (id && value) states.set(id, { ...states.get(id), [provider.surface]: value });
  } catch (error) {
    console.warn('[session] Could not capture document view:', provider.surface, error);
  }
}
export function registerDocumentViewState(surface, getId, read) {
  const provider = { surface, getId, read };
  providers.add(provider);
  return () => {
    capture(provider);
    providers.delete(provider);
    requestDocumentViewStateSave();
  };
}
export function snapshotDocumentViewStates(ids) {
  providers.forEach(capture);
  const openIds = new Set(ids);
  for (const id of states.keys()) if (!openIds.has(id)) states.delete(id);
  return Object.fromEntries(states);
}
export function restoreDocumentViewStates(saved = {}) {
  states.clear();
  for (const [id, value] of Object.entries(saved || {})) {
    if (value && typeof value === 'object') states.set(id, value);
  }
}
