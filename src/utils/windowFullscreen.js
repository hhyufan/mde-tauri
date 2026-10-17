// Windows reapplies work-area maximize bounds when an already-maximized
// undecorated window changes flags. Leave that state before real fullscreen.
export function createFullscreenController(windowHandle) {
  let pending = null;
  let restoreMaximized = false;
  const toggle = () => {
    if (pending) return pending;
    pending = (async () => {
      if (await windowHandle.isFullscreen()) {
        await windowHandle.setFullscreen(false);
        if (restoreMaximized) await windowHandle.maximize();
        restoreMaximized = false;
      } else {
        const maximized = await windowHandle.isMaximized();
        if (maximized) await windowHandle.unmaximize();
        try {
          await windowHandle.setFullscreen(true);
          restoreMaximized = maximized;
        } catch (error) {
          if (maximized) await windowHandle.maximize();
          throw error;
        }
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  return { toggle };
}
