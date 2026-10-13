import { afterEach, expect, it, vi } from 'vitest';
import { observeMarkdownEnhancements } from './observeMarkdownEnhancements';
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('ignores prose edits and batches only relevant node changes', async () => {
  const frames = new Map(); let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); };
  document.body.innerHTML = '<main><p>prose</p></main>';
  const root = document.querySelector('main');
  const enhance = vi.fn();
  const stop = observeMarkdownEnhancements(root, 'img, span[data-type="math"]', enhance, ['data-value']);
  flush(); enhance.mockClear();
  root.querySelector('p').textContent = 'ordinary typing';
  await Promise.resolve(); flush();
  expect(enhance).not.toHaveBeenCalled();
  root.insertAdjacentHTML('beforeend', '<img src="one"><span data-type="math">x</span>');
  await Promise.resolve();
  root.querySelector('span').dataset.value = 'y';
  await Promise.resolve();
  expect(frames.size).toBe(1);
  flush(); expect(enhance).toHaveBeenCalledOnce();
  stop();
});
