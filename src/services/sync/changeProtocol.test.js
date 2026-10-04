import { describe, expect, it } from 'vitest';
import {
  SYNC_CHANGE_PAGE_SIZE,
  SyncProtocolError,
  buildChangesParams,
  normalizeCheckpoint,
  parseChangesPage,
} from './changeProtocol';

describe('changeProtocol', () => {
  it('converts a legacy timestamp checkpoint to the v2 request and response shape', () => {
    const since = '2026-08-26T08:00:00.000Z';
    const nextSince = '2026-08-26T08:01:00.000Z';

    expect(normalizeCheckpoint(since)).toEqual({ mode: 'legacy', value: since });
    expect(buildChangesParams(since)).toEqual({
      since,
      cursor: '',
      limit: SYNC_CHANGE_PAGE_SIZE,
    });
    expect(parseChangesPage({
      changes: [{ fileId: 'legacy-doc', rev: 2 }],
      cursor: nextSince,
    }, since)).toEqual({
      changes: [{ fileId: 'legacy-doc', rev: 2 }],
      checkpoint: { mode: 'legacy', value: nextSince },
      hasMore: false,
    });
  });

  it('converts a v3 seek page into the next opaque cursor request', () => {
    const page = parseChangesPage({
      changes: [{ fileId: 'doc-v3', rev: 7 }],
      nextCursor: 'seek:0002',
      hasMore: true,
    }, { mode: 'v3', value: 'seek:0001' });

    expect(page).toEqual({
      changes: [{ fileId: 'doc-v3', rev: 7 }],
      checkpoint: { mode: 'v3', value: 'seek:0002' },
      hasMore: true,
    });
    expect(buildChangesParams(page.checkpoint, 50)).toEqual({
      cursor: 'seek:0002',
      limit: 50,
    });
  });

  it('rejects a paginated v3 response whose cursor does not advance', () => {
    expect(() => parseChangesPage({
      changes: [],
      nextCursor: 'seek:stuck',
      hasMore: true,
    }, { mode: 'v3', value: 'seek:stuck' })).toThrowError(SyncProtocolError);

    try {
      parseChangesPage({
        changes: [],
        nextCursor: 'seek:stuck',
        hasMore: true,
      }, { mode: 'v3', value: 'seek:stuck' });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'SYNC_PROTOCOL_ERROR',
        details: { cursor: 'seek:stuck' },
      });
    }
  });

  it('rejects responses without a changes list or checkpoint', () => {
    expect(() => parseChangesPage({ cursor: 'legacy' }, '')).toThrowError(SyncProtocolError);
    expect(() => parseChangesPage({ changes: [] }, '')).toThrowError(SyncProtocolError);
  });
});
