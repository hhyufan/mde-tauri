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
it('offers Marksman and installs its Markdown aliases through the existing plugin flow', async () => {  const markdown = LANGUAGE_PLUGIN_CATALOG.find((plugin) => plugin.id === 'mde.marksman');
  expect(markdown.args).toEqual(['server']);
  expect(markdown.install.assets['x86_64-pc-windows-msvc']).toBe('marksman.exe');
  invoke.mockResolvedValueOnce({ manifest: markdown, enabled: true, installedVersion: markdown.version });
  await useLspStore.getState().install(markdown);
  expect(selectLanguagePlugin(useLspStore.getState(), 'markdown')?.manifest.id).toBe(markdown.id);
  expect(getFileLanguage('reading.mdown')).toBe('markdown');
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

it('主动取消的安装不留失败记录（Rust 以 Installation cancelled 收尾属预期）', async () => {
  let rejectInstall;
  invoke.mockImplementation((command) => {
    if (command === 'install_language_plugin') {
      return new Promise((_resolve, reject) => {
        rejectInstall = reject;
      });
    }
    return Promise.resolve();
  });

  const installing = useLspStore.getState().install(manifest);
  await vi.waitFor(() => expect(rejectInstall).toBeTypeOf('function'));

  await useLspStore.getState().cancelInstall(manifest.id);
  // 取消标记立刻生效，所以任务当场从列表消失，不会先变成"取消中"
  expect(useLspStore.getState().operations[manifest.id]?.phase).toBe('cancelled');

  rejectInstall(new Error('Installation cancelled'));
  await installing;

  // 记录被摘掉：任务列表不会冒出"安装失败"，插件市场也不会出现错误行
  expect(useLspStore.getState().operations[manifest.id]).toBeUndefined();
});

it('真失败仍然如实记为失败，不会被取消标记吞掉', async () => {
  invoke.mockRejectedValueOnce(new Error('network unavailable'));
  await useLspStore.getState().install(manifest);
  expect(useLspStore.getState().operations[manifest.id]).toMatchObject({
    phase: 'error',
    text: 'network unavailable',
  });
});

it('把配置的加速前缀随安装请求交给 Rust（下载时才用得上）', async () => {
  useLspStore.setState({ githubAccelerator: 'https://ghfast.top/' });
  invoke.mockResolvedValueOnce({ manifest, enabled: true, installedVersion: '1.0.0' });
  await useLspStore.getState().install(manifest);
  const [command, args] = invoke.mock.calls.at(-1);
  expect(command).toBe('install_language_plugin');
  expect(args.manifest.install.accelerator).toBe('https://ghfast.top/');
});

it('没配加速前缀时原样传目录里的配方，不做多余拷贝', async () => {
  useLspStore.setState({ githubAccelerator: '   ' });
  invoke.mockResolvedValueOnce({ manifest, enabled: true, installedVersion: '1.0.0' });
  await useLspStore.getState().install(manifest);
  const [, args] = invoke.mock.calls.at(-1);
  expect(args.manifest).toBe(manifest);
});
