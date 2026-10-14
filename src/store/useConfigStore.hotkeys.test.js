import { beforeEach, expect, it, vi } from 'vitest';
import useConfigStore from './useConfigStore';
import { DEFAULT_HOTKEYS, resolveHotkeys } from '@/configs/hotkeys';
import { clearHotkeyProbeCache, probeHotkeyAvailability } from '@utils/hotkeyProbe';

// 探测模块会在浏览器外退回 unsupported，这里显式替换成可观测的探针。
vi.mock('@utils/tauriApi', () => ({
  checkHotkeyAvailable: vi.fn(async () => ({ status: 'available' })),
}));

beforeEach(() => {
  clearHotkeyProbeCache();
  useConfigStore.setState({ hotkeys: { ...DEFAULT_HOTKEYS } });
});

it('normalizes imported hotkeys instead of spreading them raw', () => {
  // 快照来自旧版本：含已下线的动作 id、缺失的动作、非字符串的脏值。
  useConfigStore.getState().loadConfig({
    hotkeys: { removedAction: 'Ctrl+KeyZ', save: 42, search: 'Ctrl+Alt+KeyK' },
  });

  const stored = useConfigStore.getState().hotkeys;
  expect(stored.removedAction).toBeUndefined();
  // 非法值回落默认，合法值保留，缺失动作补齐。
  expect(stored.save).toBe(DEFAULT_HOTKEYS.save);
  expect(stored.search).toBe('Ctrl+Alt+KeyK');
  expect(stored.togglePreview).toBe(DEFAULT_HOTKEYS.togglePreview);
});

it('leaves other config keys untouched when importing', () => {
  useConfigStore.getState().loadConfig({ fontSize: 18, hotkeys: { save: 'Ctrl+Alt+KeyS' } });
  expect(useConfigStore.getState().fontSize).toBe(18);
  expect(useConfigStore.getState().hotkeys.save).toBe('Ctrl+Alt+KeyS');
});

it('drops the whole hotkey table to defaults when an import omits it', () => {
  useConfigStore.setState({ hotkeys: { ...DEFAULT_HOTKEYS, save: 'Ctrl+Alt+KeyS' } });
  useConfigStore.getState().loadConfig({ fontSize: 15 });
  // 没有携带 hotkeys 的快照不应把键位表清空或改坏。
  expect(useConfigStore.getState().hotkeys.save).toBe('Ctrl+Alt+KeyS');
});

it('invalidates cached probe verdicts after importing hotkeys', async () => {
  const probe = vi.fn(async () => ({ status: 'available' }));

  await probeHotkeyAvailability('Ctrl+Alt+KeyJ', probe, 1_000);
  await probeHotkeyAvailability('Ctrl+Alt+KeyJ', probe, 1_100);
  expect(probe).toHaveBeenCalledTimes(1);

  useConfigStore.getState().loadConfig({ hotkeys: { save: 'Ctrl+Alt+KeyS' } });
  // 键位表整体替换后必须重新问系统，否则会拿着旧结论去判断新配置。
  await vi.waitFor(async () => {
    await probeHotkeyAvailability('Ctrl+Alt+KeyJ', probe, 1_200);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

it('invalidates cached probe verdicts after restoring defaults', async () => {
  const probe = vi.fn(async () => ({ status: 'taken' }));

  await probeHotkeyAvailability('Ctrl+Alt+KeyH', probe, 2_000);
  expect(probe).toHaveBeenCalledTimes(1);

  useConfigStore.getState().resetHotkeys();
  await vi.waitFor(async () => {
    await probeHotkeyAvailability('Ctrl+Alt+KeyH', probe, 2_100);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

it('seeds a complete hotkey table so the panel never sees holes', () => {
  const resolved = resolveHotkeys(useConfigStore.getState().hotkeys);
  expect(Object.keys(resolved).sort()).toEqual(Object.keys(DEFAULT_HOTKEYS).sort());
});
