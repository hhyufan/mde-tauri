import { afterEach, expect, it, vi } from 'vitest';
import { debounceByKey } from './debounce';
afterEach(() => vi.useRealTimers());

it('coalesces edits to each document without dropping another document save', () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const schedule = debounceByKey(save, 1000);
  schedule('a', 'old'); schedule('b', 'other'); schedule('a', 'latest');
  vi.advanceTimersByTime(1000);
  expect(save.mock.calls).toEqual([['b', 'other'], ['a', 'latest']]);
  schedule('c', 'cancelled'); schedule.cancel();
  vi.advanceTimersByTime(1000);
  expect(save).toHaveBeenCalledTimes(2);
});
