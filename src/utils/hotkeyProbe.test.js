import { beforeEach, expect, it, vi } from 'vitest';
import { clearHotkeyProbeCache, probeHotkeyAvailability } from './hotkeyProbe';

beforeEach(() => {
  clearHotkeyProbeCache();
});

it('passes the native verdict through unchanged', async () => {
  const probe = vi.fn(async () => ({ status: 'taken' }));
  expect(await probeHotkeyAvailability('Ctrl+Shift+KeyT', probe)).toEqual({ status: 'taken' });
  expect(probe).toHaveBeenCalledWith('Ctrl+Shift+KeyT');
});

it('never reports "available" when probing is impossible', async () => {
  // 浏览器 / macOS / Linux 返回 unsupported 时必须原样透出：这是“不知道”，
  // 不是“可用”。调用方据此只说“无法验证”。
  const probe = async () => ({ status: 'unsupported', platform: 'web' });
  expect(await probeHotkeyAvailability('Ctrl+KeyS', probe)).toEqual({
    status: 'unsupported',
    platform: 'web',
  });
});

it('does not call the native side for an empty binding', async () => {
  const probe = vi.fn();
  expect(await probeHotkeyAvailability('', probe)).toEqual({ status: 'invalid', reason: 'empty' });
  expect(probe).not.toHaveBeenCalled();
});

it('caches a verdict for a short window', async () => {
  const probe = vi.fn(async () => ({ status: 'available' }));
  await probeHotkeyAvailability('Ctrl+KeyK', probe, 1_000);
  await probeHotkeyAvailability('Ctrl+KeyK', probe, 2_000);
  expect(probe).toHaveBeenCalledTimes(1);
});

it('re-probes once the cached verdict expires', async () => {
  const probe = vi.fn(async () => ({ status: 'available' }));
  await probeHotkeyAvailability('Ctrl+KeyK', probe, 1_000);
  // 超过 TTL 后必须重新问原生：别的程序可能刚占用或刚释放这个键位。
  await probeHotkeyAvailability('Ctrl+KeyK', probe, 1_000 + 15_001);
  expect(probe).toHaveBeenCalledTimes(2);
});

it('merges concurrent probes for the same binding into one call', async () => {
  // 手动控制 resolve 时机：探测实现是在微任务里被调用的，不能假定同步就绪。
  let resolveProbe;
  const gate = new Promise((resolve) => { resolveProbe = resolve; });
  const probe = vi.fn(() => gate);
  const first = probeHotkeyAvailability('Ctrl+KeyJ', probe);
  const second = probeHotkeyAvailability('Ctrl+KeyJ', probe);
  resolveProbe({ status: 'taken' });
  expect(await first).toEqual({ status: 'taken' });
  expect(await second).toEqual({ status: 'taken' });
  expect(probe).toHaveBeenCalledTimes(1);
});

it('degrades to unsupported when the probe rejects', async () => {
  const probe = vi.fn(async () => { throw new Error('ipc down'); });
  expect(await probeHotkeyAvailability('Ctrl+KeyH', probe)).toEqual({ status: 'unsupported' });
});

it('coerces a malformed probe result into unsupported rather than trusting it', async () => {
  expect(await probeHotkeyAvailability('Ctrl+KeyG', async () => undefined)).toEqual({
    status: 'unsupported',
  });
});

it('forgets every verdict once the cache is cleared', async () => {
  const probe = vi.fn(async () => ({ status: 'taken' }));
  await probeHotkeyAvailability('Ctrl+KeyF', probe, 1_000);
  clearHotkeyProbeCache();
  await probeHotkeyAvailability('Ctrl+KeyF', probe, 1_500);
  expect(probe).toHaveBeenCalledTimes(2);
});
