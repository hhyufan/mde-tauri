import { describe, expect, it } from 'vitest';
import {
  getMutationRetryAt,
  getRetryAfterMs,
  isRetryableSyncError,
} from './retryPolicy';

describe('retryPolicy', () => {
  it('honors a 429 Retry-After delay expressed in seconds', () => {
    const now = Date.parse('2026-08-26T08:00:00.000Z');
    const error = {
      response: {
        status: 429,
        headers: { 'retry-after': '120' },
      },
    };

    expect(getRetryAfterMs(error, now)).toBe(120_000);
    expect(getMutationRetryAt({
      kind: 'rate_limited',
      retryCount: 1,
      error,
      now,
    })).toBe(now + 120_000);
  });

  it('honors an HTTP-date Retry-After header', () => {
    const now = Date.parse('2026-08-26T08:00:00.000Z');
    const retryAt = 'Wed, 26 Aug 2026 08:02:30 GMT';

    expect(getRetryAfterMs({
      response: { headers: new Headers({ 'Retry-After': retryAt }) },
    }, now)).toBe(150_000);
  });

  it.each([
    'request_error',
    'auth_required',
    'conflict',
    'payload_too_large',
  ])('does not retry permanent %s failures', (kind) => {
    expect(isRetryableSyncError(kind)).toBe(false);
    expect(getMutationRetryAt({
      kind,
      retryCount: 1,
      error: { response: { headers: { 'retry-after': '5' } } },
      now: 1_000,
    })).toBeNull();
  });

  it('uses deterministic exponential backoff when no Retry-After header exists', () => {
    expect(getMutationRetryAt({
      kind: 'server_error',
      retryCount: 3,
      error: {},
      now: 10_000,
      random: () => 0.5,
    })).toBe(18_000);
  });
});
