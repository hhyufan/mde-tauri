import { describe, expect, it } from 'vitest';
import {
  getExplorerFileSyncState,
  resolveGlobalSyncStatus,
} from './syncPresentation';

describe('sync presentation state', () => {
  it('shows a signed-out client as offline even when sync is enabled', () => {
    expect(resolveGlobalSyncStatus({
      isLoggedIn: false,
      syncEnabled: true,
      engineStatus: 'idle',
    })).toBe('offline');
  });

  it('shows the device-bound Explorer path as a synced cloud file', () => {
    const ownerUserId = 'user-1';
    const filePath = 'C:\\notes\\cloud.md';
    expect(getExplorerFileSyncState({
      filePath,
      ownerUserId,
      pathToId: { [`${ownerUserId}::path::${filePath}`]: 'file-1' },
      docs: {
        [`${ownerUserId}::file-1`]: {
          fileId: 'file-1',
          ownerUserId,
          enrolled: true,
          status: 'synced',
        },
      },
      replicas: {
        [`${ownerUserId}::file-1`]: {
          fileId: 'file-1', ownerUserId, localPath: filePath, linkState: 'linked',
        },
      },
    })).toEqual({ fileId: 'file-1', status: 'synced' });
  });

  it('gives conflicts precedence over pending mutations in the file tree', () => {
    const ownerUserId = 'user-1';
    const filePath = 'C:\\notes\\conflict.md';
    expect(getExplorerFileSyncState({
      filePath,
      ownerUserId,
      pathToId: { [`${ownerUserId}::path::${filePath}`]: 'file-2' },
      docs: {
        [`${ownerUserId}::file-2`]: {
          fileId: 'file-2',
          ownerUserId,
          enrolled: true,
          status: 'pending_push',
        },
      },
      replicas: {
        [`${ownerUserId}::file-2`]: {
          fileId: 'file-2', ownerUserId, localPath: filePath, linkState: 'linked',
        },
      },
      queue: [{
        fileId: 'file-2',
        ownerUserId,
        status: 'pending',
      }],
      conflicts: [{ fileId: 'file-2', ownerUserId }],
    })).toEqual({ fileId: 'file-2', status: 'conflict' });
  });

  it('does not mark stopped or deleted local paths as cloud-synced', () => {
    const ownerUserId = 'user-1';
    const filePath = 'C:\\notes\\stopped.md';
    expect(getExplorerFileSyncState({
      filePath,
      ownerUserId,
      pathToId: { [`${ownerUserId}::path::${filePath}`]: 'file-3' },
      docs: {
        [`${ownerUserId}::file-3`]: {
          fileId: 'file-3',
          ownerUserId,
          enrolled: false,
          status: 'stopped',
        },
      },
      replicas: {
        [`${ownerUserId}::file-3`]: {
          fileId: 'file-3', ownerUserId, localPath: filePath, linkState: 'unlinked',
        },
      },
    })).toBeNull();
  });
});
