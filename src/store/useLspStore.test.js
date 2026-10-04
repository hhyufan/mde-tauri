import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import useLspStore, { LANGUAGE_PLUGIN_CATALOG, selectLanguagePlugin, availablePlugins } from './useLspStore';
import { getFileLanguage } from '@utils/fileLanguage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
const manifest = LANGUAGE_PLUGIN_CATALOG.find((plugin) => plugin.id === 'mde.rust');
beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  useLspStore.setState({ enabled: true, installed: [], catalog: [], sources: [], preferred: {}, operations: {}, statuses: {}, revision: 0 });
  invoke.mockReset();
});
it('only connects installed, enabled plugins and resolves explicit provider preferences', () => {
  expect(selectLanguagePlugin(useLspStore.getState(), 'rust')).toBeNull();
  const first = { manifest, enabled: false };
  const second = { manifest: { ...manifest, id: 'custom.rust' }, enabled: true };
  useLspStore.setState({ installed: [first, second] });
  expect(selectLanguagePlugin(useLspStore.getState(), 'rust')).toBe(second);
  useLspStore.setState({ installed: [{ ...first, enabled: true }, second], preferred: { rust: 'custom.rust' } });
  expect(selectLanguagePlugin(useLspStore.getState(), 'rust')).toBe(second);
});
it('installs over native IPC, enables editor contributions and removes them after uninstall', async () => {
  const custom = { ...manifest, id: 'custom.zig', name: 'Zig', languages: ['zig'], extensions: { zig: 'zig' } };
  invoke.mockResolvedValueOnce({ manifest: custom, enabled: true, installedVersion: '1.0' });
  await useLspStore.getState().install(custom);
  expect(invoke).toHaveBeenCalledWith('install_language_plugin', { manifest: custom });
  expect(getFileLanguage('main.zig')).toBe('zig');
  expect(selectLanguagePlugin(useLspStore.getState(), 'zig').manifest.id).toBe(custom.id);
  invoke.mockResolvedValueOnce(undefined);
  await useLspStore.getState().uninstall(custom.id);
  expect(invoke).toHaveBeenLastCalledWith('uninstall_language_plugin', { id: custom.id });
  expect(selectLanguagePlugin(useLspStore.getState(), 'zig')).toBeNull();
  expect(getFileLanguage('main.zig')).toBe('plaintext');
});
it('does not mark failed installations successful and retains plugins on failed uninstall', async () => {
  invoke.mockRejectedValueOnce(new Error('network unavailable'));
  await useLspStore.getState().install(manifest);
  expect(useLspStore.getState().installed).toEqual([]);
  expect(useLspStore.getState().operations[manifest.id]).toMatchObject({ phase: 'error', text: 'network unavailable' });
  useLspStore.setState({ installed: [{ manifest, enabled: true }] });
  invoke.mockRejectedValueOnce(new Error('file locked'));
  await useLspStore.getState().uninstall(manifest.id);
  expect(useLspStore.getState().installed).toHaveLength(1);
  expect(selectLanguagePlugin(useLspStore.getState(), 'rust').manifest.id).toBe(manifest.id);
});
it('imports online catalogs and custom languages without a built-in language whitelist', async () => {
  const custom = { ...manifest, id: 'custom.elixir', name: 'Elixir', languages: ['elixir'], extensions: { ex: 'elixir' } };
  invoke.mockResolvedValueOnce([custom]);
  await useLspStore.getState().addCatalog('https://example.com/catalog.json');
  expect(availablePlugins(useLspStore.getState())).toContainEqual(custom);
  expect(useLspStore.getState().sources).toEqual(['https://example.com/catalog.json']);
  expect(() => useLspStore.getState().addManifest({ id: 'bad' })).toThrow('Invalid');
});
