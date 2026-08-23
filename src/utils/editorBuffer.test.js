import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBuffer, getBuffer, renameBuffer, setBuffer, subscribe } from './editorBuffer';

describe('editorBuffer', () => {
  beforeEach(() => {
    clearBuffer('a');
    clearBuffer('b');
  });

  it('stores and renames the live editor content', () => {
    setBuffer('a', 'draft');
    renameBuffer('a', 'b');
    expect(getBuffer('a', 'missing')).toBe('missing');
    expect(getBuffer('b')).toBe('draft');
  });

  it('batches changed ids for subscribers', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setBuffer('a', 'one');
    setBuffer('a', 'two');
    setBuffer('b', 'three');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(new Set(['a', 'b']));
    unsubscribe();
  });
});
