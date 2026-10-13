import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { markdownAnalysis } from '@/services/markdownAnalysis';
import { useMarkdownAnalysis } from './useMarkdownAnalysis';

vi.mock('@/services/markdownAnalysis', () => ({ markdownAnalysis: { analyze: vi.fn() } }));
afterEach(cleanup);

it('keeps the current preview while analyzing and rejects late results after switching documents', async () => {
  const requests = [];
  markdownAnalysis.analyze.mockImplementation(() => new Promise((resolve) => requests.push(resolve)));
  const source = 'x'.repeat(200001);
  const { result, rerender } = renderHook(({ id, content }) => useMarkdownAnalysis(id, content, 'footnotes'), {
    initialProps: { id: 'a', content: source },
  });
  expect(result.current).toEqual({ value: '', pending: true });
  await act(async () => requests[0]({ footnotes: 'A' }));
  expect(result.current.value).toBe('A');
  rerender({ id: 'a', content: source + 'changed' });
  expect(result.current).toEqual({ value: 'A', pending: true });
  rerender({ id: 'b', content: source + 'other' });
  expect(result.current).toEqual({ value: '', pending: true });
  await act(async () => requests[1]({ footnotes: 'late A' }));
  expect(result.current.value).toBe('');
  await act(async () => requests[2]({ footnotes: 'B' }));
  expect(result.current).toEqual({ value: 'B', pending: false });
});
