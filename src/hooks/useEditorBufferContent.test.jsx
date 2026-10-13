import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import { useEditorBufferContent } from './useEditorBufferContent';
afterEach(() => { cleanup(); clearBuffer('a'); clearBuffer('b'); vi.useRealTimers(); });

it('returns the new document immediately and cancels the previous document timer', () => {
  vi.useFakeTimers();
  setBuffer('a', 'one'); setBuffer('b', 'two');
  const { result, rerender } = renderHook(({ id }) => useEditorBufferContent(id), { initialProps: { id: 'a' } });
  act(() => { setBuffer('a', 'edited'); vi.advanceTimersByTime(1); });
  rerender({ id: 'b' });
  expect(result.current).toBe('two');
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe('two');
  rerender({ id: 'a' });
  expect(result.current).toBe('edited');
});
