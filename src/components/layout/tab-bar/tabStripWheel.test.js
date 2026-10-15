import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installTabStripWheel } from './tabStripWheel';
beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let handler;
  const container = {
    scrollLeft: 0, scrollWidth: 700, clientWidth: 250,
    getBoundingClientRect: () => ({ left: 20 }),
    querySelectorAll: () => [4, 104, 284, 424, 604].map((left) => ({ getBoundingClientRect: () => ({ left: left + 20 - container.scrollLeft }) })),
    addEventListener: (_name, fn) => { handler = fn; }, removeEventListener: vi.fn(), scrollTo: vi.fn(),
  };
  const cleanup = installTabStripWheel(container);
  const wheel = (deltaY, extras = {}) => {
    const event = { deltaY, deltaX: 0, timeStamp: 100, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extras };
    handler(event); return event;
  };
  return { container, wheel, cleanup };
}
it('scrolls one variable-width tab per notch, even during an ongoing smooth scroll', () => {
  const { container, wheel } = fixture();
  expect(wheel(100).preventDefault).toHaveBeenCalled();
  expect(container.scrollTo).toHaveBeenLastCalledWith({ left: 100, top: 0, behavior: 'smooth' });
  wheel(100);
  expect(container.scrollTo).toHaveBeenLastCalledWith({ left: 280, top: 0, behavior: 'smooth' });
  wheel(-100);
  expect(container.scrollTo).toHaveBeenLastCalledWith({ left: 100, top: 0, behavior: 'smooth' });
});
it('clamps to either end and handles horizontal gestures without vertical scrolling', () => {
  const { container, wheel } = fixture();
  wheel(-100); expect(container.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 0, top: 0 }));
  for (let i = 0; i < 8; i++) wheel(0, { deltaX: 100 });
  expect(container.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 450, top: 0 }));
});
it('accumulates small trackpad movement and preserves browser zoom', () => {
  const { container, wheel, cleanup } = fixture();
  for (let i = 0; i < 3; i++) wheel(10);
  expect(container.scrollTo).not.toHaveBeenCalled();
  wheel(10); expect(container.scrollTo).toHaveBeenCalledTimes(1);
  expect(wheel(100, { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
  cleanup(); expect(container.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
});
