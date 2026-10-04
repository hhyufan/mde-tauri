const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export const RETRYABLE_SYNC_ERRORS = new Set([
  'offline',
  'server_unreachable',
  'server_error',
  'rate_limited',
  'error',
]);

export function isRetryableSyncError(kind) {
  return RETRYABLE_SYNC_ERRORS.has(kind);
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

export function getRetryAfterMs(error, now = Date.now()) {
  const value = readHeader(error?.response?.headers, 'retry-after');
  if (value === undefined || value === null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(String(value));
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

/** Return null for terminal errors, otherwise an absolute retry timestamp. */
export function getMutationRetryAt({
  kind,
  retryCount,
  error,
  now = Date.now(),
  random = Math.random,
}) {
  if (!isRetryableSyncError(kind)) return null;
  const retryAfterMs = getRetryAfterMs(error, now);
  if (retryAfterMs !== null) return now + Math.min(MAX_RETRY_DELAY_MS, retryAfterMs);

  const exponent = Math.max(0, Number(retryCount || 1) - 1);
  const baseDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** exponent));
  const jitter = 0.8 + (Math.max(0, Math.min(1, random())) * 0.4);
  return now + Math.round(baseDelay * jitter);
}
