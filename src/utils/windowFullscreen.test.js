import { expect, it, vi } from 'vitest';
import { createFullscreenController } from './windowFullscreen';

function nativeWindow(maximized) {
  const state = { maximized, fullscreen: false, height: maximized ? 1040 : 800 };
  const handle = {
    isFullscreen: vi.fn(async () => state.fullscreen),
    isMaximized: vi.fn(async () => state.maximized),
    unmaximize: vi.fn(async () => {
      state.maximized = false;
      state.height = 800;
    }),
    maximize: vi.fn(async () => {
      state.maximized = true;
      state.height = 1040;
    }),
    setFullscreen: vi.fn(async (value) => {
      state.fullscreen = value;
      // Reproduce Windows retaining the work-area constraint while maximized.
      state.height = value ? (state.maximized ? 1040 : 1080) : 800;
    }),
  };
  return { state, handle, controller: createFullscreenController(handle) };
}

it('uses the full monitor instead of the maximized work area, then restores maximization', async () => {
  const { controller, state, handle } = nativeWindow(true);
  await controller.toggle();
  expect(state).toEqual({ fullscreen: true, maximized: false, height: 1080 });
  await controller.toggle();
  expect(state).toEqual({ fullscreen: false, maximized: true, height: 1040 });
  expect(handle.setFullscreen.mock.calls).toEqual([[true], [false]]);
});

it('restores an ordinary window without maximizing it', async () => {
  const { controller, state, handle } = nativeWindow(false);
  await controller.toggle();
  await controller.toggle();
  expect(state.height).toBe(800);
  expect(handle.maximize).not.toHaveBeenCalled();
  expect(handle.unmaximize).not.toHaveBeenCalled();
});

it('coalesces overlapping key events into a single native transition', async () => {
  const { controller, handle } = nativeWindow(true);
  const first = controller.toggle(),
    second = controller.toggle();
  expect(second).toBe(first);
  await Promise.all([first, second]);
  expect(handle.setFullscreen).toHaveBeenCalledTimes(1);
});

it('restores the original state when entering fullscreen fails, and allows retry', async () => {
  const { controller, state, handle } = nativeWindow(true);
  handle.setFullscreen.mockRejectedValueOnce(new Error('fullscreen failed'));
  await expect(controller.toggle()).rejects.toThrow('fullscreen failed');
  expect(state.maximized).toBe(true);
  await controller.toggle();
  expect(state.height).toBe(1080);
});
