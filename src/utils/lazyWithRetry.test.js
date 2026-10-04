import { describe, expect, it, vi } from 'vitest';
import { importWithRetry, isRecoverableImportError } from './lazyWithRetry';

describe('lazyWithRetry', () => {
  it('retries transient dynamic import failures', async () => {
    const module = { default: () => null };
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(module);

    await expect(importWithRetry(importer, { retries: 1, delayMs: 0 })).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('does not retry module evaluation errors', async () => {
    const error = new Error('Component initialization failed');
    const importer = vi.fn().mockRejectedValue(error);

    await expect(importWithRetry(importer, { retries: 2, delayMs: 0 })).rejects.toBe(error);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('recognizes Vite stale dependency errors', () => {
    expect(isRecoverableImportError(new Error('Outdated Optimize Dep'))).toBe(true);
  });
});
