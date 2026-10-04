export const SYNC_CHANGE_PAGE_SIZE = 25;

export class SyncProtocolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SyncProtocolError';
    this.code = 'SYNC_PROTOCOL_ERROR';
    this.details = details;
  }
}

function looksLikeLegacyTimestamp(value) {
  if (!value || typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.includes('T');
}

export function normalizeCheckpoint(checkpoint) {
  if (typeof checkpoint === 'string') {
    return {
      mode: looksLikeLegacyTimestamp(checkpoint) ? 'legacy' : checkpoint ? 'v3' : 'auto',
      value: checkpoint,
    };
  }
  const value = typeof checkpoint?.value === 'string' ? checkpoint.value : '';
  const mode = ['auto', 'legacy', 'v3'].includes(checkpoint?.mode)
    ? checkpoint.mode
    : looksLikeLegacyTimestamp(value) ? 'legacy' : value ? 'v3' : 'auto';
  return { mode, value };
}

/**
 * Build a request that upgrades itself to seek pagination when the server supports
 * it, while remaining compatible with the previous timestamp-based endpoint.
 */
export function buildChangesParams(checkpoint, limit = SYNC_CHANGE_PAGE_SIZE) {
  const current = normalizeCheckpoint(checkpoint);
  if (current.mode === 'legacy' && current.value) {
    return { since: current.value, cursor: '', limit };
  }
  return { cursor: current.value, limit };
}

export function parseChangesPage(data, previousCheckpoint) {
  if (!data || !Array.isArray(data.changes)) {
    throw new SyncProtocolError('The sync server returned an invalid changes page');
  }

  const previous = normalizeCheckpoint(previousCheckpoint);
  const isSeekPage = Object.hasOwn(data, 'nextCursor') || Object.hasOwn(data, 'hasMore');
  if (isSeekPage) {
    const value = typeof data.nextCursor === 'string' ? data.nextCursor : previous.value;
    const hasMore = Boolean(data.hasMore);
    if (hasMore && value === previous.value) {
      throw new SyncProtocolError('The sync cursor did not advance', { cursor: value });
    }
    return {
      changes: data.changes,
      checkpoint: { mode: 'v3', value },
      hasMore,
    };
  }

  if (!Object.hasOwn(data, 'cursor')) {
    throw new SyncProtocolError('The sync server did not return a checkpoint');
  }
  return {
    changes: data.changes,
    checkpoint: {
      mode: 'legacy',
      value: typeof data.cursor === 'string' ? data.cursor : previous.value,
    },
    hasMore: false,
  };
}
