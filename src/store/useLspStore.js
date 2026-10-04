import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import bundledCatalog from '@/configs/language-plugins.json';
import useProblemsStore from './useProblemsStore';

export const LANGUAGE_PLUGIN_CATALOG = bundledCatalog;
let subscription;
let refreshing;
const toggling = new Set();
function desktop() { return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__); }
async function events() {
  if (!subscription) subscription = listen('language-plugin-progress', ({ payload }) => {
    useLspStore.setState((state) => ({ operations: { ...state.operations, [payload.id]: {
      ...state.operations[payload.id], ...payload, text: String(payload.text || '').slice(-8192),
    } } }));
  }).catch((error) => { subscription = null; throw error; });
  return subscription;
}
export function availablePlugins(state) {
  const plugins = new Map(bundledCatalog.map((plugin) => [plugin.id, plugin]));
  for (const plugin of state.catalog) plugins.set(plugin.id, plugin);
  for (const plugin of state.installed) if (!plugins.has(plugin.manifest.id)) plugins.set(plugin.manifest.id, plugin.manifest);
  return [...plugins.values()];
}
export function selectLanguagePlugin(state, language) {
  if (!state.enabled) return null;
  const matches = state.installed.filter((plugin) => plugin.enabled
    && state.operations?.[plugin.manifest.id]?.phase !== 'uninstalling'
    && plugin.manifest.languages.includes(language));
  return matches.find((plugin) => plugin.manifest.id === state.preferred[language]) || matches[0] || null;
}
export function validatePluginManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !/^[a-z0-9][a-z0-9.-]*$/i.test(manifest.id || '')
    || !manifest.name?.trim() || !Array.isArray(manifest.languages) || !manifest.languages.length
    || !manifest.languages.every((language) => typeof language === 'string' && /^[a-z0-9][a-z0-9.-]*$/i.test(language))
    || !manifest.install || !['npm', 'dotnet', 'github', 'archive', 'jdtls'].includes(manifest.install.kind)) {
    throw new Error('Invalid language-service plugin manifest');
  }
  return { version: 'latest', publisher: 'Community', description: '', args: [], extensions: {}, ...manifest };
}
const useLspStore = create(persist((set, get) => ({
  enabled: true, catalog: [], sources: [], preferred: {}, installed: [], operations: {}, statuses: {}, revision: 0,
  loading: false, loadError: '',
  setEnabled: (enabled) => {
    if (!enabled) useProblemsStore.getState().clearOwner('lsp');
    set((state) => ({ enabled, revision: state.revision + 1 }));
  },
  setPreferred: (language, id) => set((state) => ({ preferred: { ...state.preferred, [language]: id }, revision: state.revision + 1 })),
  setStatus: (id, status, message = '') => set((state) => ({ statuses: { ...state.statuses, [id]: { status, message } } })),
  restart: () => set((state) => ({ revision: state.revision + 1 })),
  refresh: async () => {
    if (!desktop()) return;
    if (refreshing) return refreshing;
    set({ loading: true, loadError: '' });
    refreshing = (async () => {
      try {
        await events();
        const installed = await invoke('list_language_plugins');
        set((state) => ({ installed, loading: false, revision: state.revision + 1 }));
      } catch (error) { set({ loading: false, loadError: String(error?.message || error) }); }
      finally { refreshing = null; }
    })();
    return refreshing;
  },
  addCatalog: async (url) => {
    const catalog = (await invoke('fetch_language_catalog', { url })).map(validatePluginManifest);
    set((state) => ({ catalog: [...new Map([...state.catalog, ...catalog].map((manifest) => [manifest.id, manifest])).values()], sources: [...new Set([...state.sources, url])] }));
  },
  addManifest: (manifest) => {
    manifest = validatePluginManifest(manifest);
    set((state) => ({ catalog: [...state.catalog.filter((plugin) => plugin.id !== manifest.id), manifest] }));
  },
  install: async (manifest) => {
    const id = manifest.id;
    if (['preparing', 'downloading', 'extracting', 'installing', 'uninstalling'].includes(get().operations[id]?.phase)) return;
    set((state) => ({ operations: { ...state.operations, [id]: { phase: 'preparing', text: '' } } }));
    try {
      await events();
      const plugin = await invoke('install_language_plugin', { manifest });
      set((state) => ({ installed: [...state.installed.filter((entry) => entry.manifest.id !== id), plugin], operations: { ...state.operations, [id]: { phase: 'complete' } }, revision: state.revision + 1 }));
    } catch (error) { set((state) => ({ operations: { ...state.operations, [id]: { phase: 'error', text: String(error?.message || error) } } })); }
  },
  cancelInstall: async (id) => invoke('cancel_language_plugin_install', { id }),
  togglePlugin: async (id, enabled) => {
    if (toggling.has(id)) return;
    toggling.add(id);
    const previous = get().installed.find((plugin) => plugin.manifest.id === id)?.enabled;
    const apply = (enabled) => set((state) => ({
      installed: state.installed.map((plugin) => plugin.manifest.id === id ? { ...plugin, enabled } : plugin),
      revision: state.revision + 1,
    }));
    if (!enabled) {
      apply(false);
      useProblemsStore.getState().clearOwner(`lsp:${id}`);
    }
    try {
      await invoke('set_language_plugin_enabled', { id, enabled });
      if (enabled) apply(true);
    } catch (error) {
      if (!enabled && previous != null) apply(previous);
      throw error;
    } finally { toggling.delete(id); }
  },
  uninstall: async (id) => {
    set((state) => ({ operations: { ...state.operations, [id]: { phase: 'uninstalling' } }, revision: state.revision + 1 }));
    try {
      await invoke('uninstall_language_plugin', { id });
      useProblemsStore.getState().clearOwner(`lsp:${id}`);
      set((state) => ({ installed: state.installed.filter((entry) => entry.manifest.id !== id), operations: { ...state.operations, [id]: { phase: 'removed' } },
        statuses: { ...state.statuses, [id]: { status: 'idle', message: '' } }, revision: state.revision + 1 }));
    } catch (error) { set((state) => ({ operations: { ...state.operations, [id]: { phase: 'error', text: String(error?.message || error) } }, revision: state.revision + 1 })); }
  },
}), { name: 'mde-language-plugins', partialize: ({ enabled, catalog, sources, preferred }) => ({ enabled, catalog, sources, preferred }) }));
export default useLspStore;
if (import.meta.hot) import.meta.hot.dispose(() => { subscription?.then((stop) => stop()); });
