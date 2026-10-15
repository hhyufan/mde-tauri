import { afterEach, expect, it, vi } from 'vitest';
import { installTabStripDrag } from './tabStripDrag';

let cleanup;
afterEach(() => { cleanup?.(); document.body.innerHTML = ''; });
function fixture() {
  document.body.innerHTML = '<div id="tabs"><div data-tab-id="a"><span>A</span><input /><button>close</button></div><div data-tab-id="b">B</div><div data-tab-id="c">C</div></div>';
  const container = document.querySelector('#tabs');
  container.setPointerCapture = vi.fn();
  container.hasPointerCapture = () => false;
  container.scrollBy = vi.fn();
  container.getBoundingClientRect = () => ({ left: 0, right: 300 });
  [...container.children].forEach((tab, index) => { tab.getBoundingClientRect = () => ({ left: index * 100, right: (index + 1) * 100, width: 100 }); });
  const callbacks = { onDragChange: vi.fn(), onDropTarget: vi.fn(), onReorder: vi.fn() };
  cleanup = installTabStripDrag(container, callbacks);
  const pointer = (type, x, target = container.firstChild.firstChild) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  return { container, pointer, ...callbacks };
}
it('reorders after a pointer drag without native HTML drag events', () => {
  const { pointer, onReorder, onDragChange, container } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 280, window); pointer('pointerup', 280, window);
  expect(onReorder).toHaveBeenCalledWith('a', 'c', true);
  expect(onDragChange).toHaveBeenLastCalledWith(null);
  expect(container.firstChild.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
});
it('preserves ordinary clicks and small mouse movements', () => {
  const { pointer, onReorder, container } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 32); pointer('pointerup', 32);
  expect(onReorder).not.toHaveBeenCalled();
  expect(container.setPointerCapture).not.toHaveBeenCalled();
  expect(container.firstChild.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true);
});
it('cancels with Escape instead of moving a tab', () => {
  const { pointer, onReorder, onDragChange } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 180);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  pointer('pointerup', 180);
  expect(onReorder).not.toHaveBeenCalled();
  expect(onDragChange).toHaveBeenLastCalledWith(null);
});
it('does not start dragging from rename inputs or close buttons', () => {
  const { container, pointer, onReorder } = fixture();
  for (const target of container.querySelectorAll('input,button')) {
    pointer('pointerdown', 30, target); pointer('pointermove', 280); pointer('pointerup', 280);
  }
  expect(onReorder).not.toHaveBeenCalled();
});
it('scrolls at the strip edge and cancels when the pointer is interrupted', () => {
  const { container, pointer, onReorder, onDragChange } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 299);
  expect(container.scrollBy).toHaveBeenCalledWith({ left: 10, behavior: 'instant' });
  pointer('pointercancel', 299, container);
  pointer('pointerup', 299);
  expect(onReorder).not.toHaveBeenCalled();
  expect(onDragChange).toHaveBeenLastCalledWith(null);
});
