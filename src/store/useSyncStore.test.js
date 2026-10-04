import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import useAuthStore from './useAuthStore';
import useSyncStore, {
  migratePersistedState,
  waitForSyncStatePersistence,
  waitForSyncStoreHydration,
} from './useSyncStore';

const USER_ID = 'sync-store-test-user';

function logInAsTestUser() {
  useAuthStore.setState({
    user: { id: USER_ID, email: 'sync-store@example.test' },
    token: 'test-token',
    isLoggedIn: true,
    loading: false,
  });
}

function queueFor(fileId) {
  return useSyncStore.getState().listQueue().filter((item) => item.fileId === fileId);
}

describe('useSyncStore outbox invariants', () => {
  beforeAll(async () => {
    await waitForSyncStoreHydration();
  });

  beforeEach(async () => {
    logInAsTestUser();
    useSyncStore.getState().clearAllSyncState();
    await waitForSyncStatePersistence();
  });

  afterAll(async () => {
    useSyncStore.getState().clearAllSyncState();
    useAuthStore.setState({
      user: null,
      token: null,
      isLoggedIn: false,
      loading: false,
    });
    await waitForSyncStatePersistence();
  });

  it('recovers persisted processing mutations as retryable pending work', () => {
    const startedAt = Date.now();
    const migrated = migratePersistedState({
      stateSchemaVersion: 3,
      docs: {},
      queue: [{
        id: 'processing-1',
        mutationId: 'processing-1',
        fileId: 'doc-processing',
        type: 'upsert',
        payload: { checksum: 'local-hash' },
        baseRev: 4,
        status: 'processing',
        nextRetryAt: startedAt + 60_000,
        processingStartedAt: startedAt - 1_000,
        ownerUserId: USER_ID,
      }],
      conflicts: [],
    });

    expect(migrated.queue).toHaveLength(1);
    expect(migrated.queue[0]).toMatchObject({
      mutationId: 'processing-1',
      fileId: 'doc-processing',
      baseRev: 4,
      status: 'pending',
      ownerUserId: USER_ID,
    });
    expect(migrated.queue[0].recoveredAt).toBeGreaterThanOrEqual(startedAt);
    expect(migrated.queue[0].nextRetryAt).toBeLessThanOrEqual(Date.now());
  });

  it('migrates only locally bound v4 documents into device replicas', () => {
    const migrated = migratePersistedState({
      stateSchemaVersion: 4,
      docs: {
        [`${USER_ID}::local-doc`]: {
          fileId: 'local-doc',
          ownerUserId: USER_ID,
          localPath: 'C:\\notes\\local.md',
          enrolled: true,
          lastKnownServerRev: 4,
          serverChecksum: 'server-4',
          localChecksum: 'local-4',
        },
        [`${USER_ID}::cloud-only`]: {
          fileId: 'cloud-only',
          ownerUserId: USER_ID,
          localPath: '',
          enrolled: true,
          lastKnownServerRev: 2,
        },
      },
      queue: [],
      conflicts: [],
    });

    expect(migrated.replicas[`${USER_ID}::local-doc`]).toMatchObject({
      fileId: 'local-doc',
      localPath: 'C:\\notes\\local.md',
      linkState: 'linked',
      baseRev: 4,
      baseChecksum: 'server-4',
      localChecksum: 'local-4',
    });
    expect(migrated.replicas[`${USER_ID}::cloud-only`]).toBeUndefined();
  });

  it('persists a replica and its first outbox snapshot in one store update', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-link-transaction',
      type: 'upsert',
      payload: { checksum: 'local-hash' },
      docPatch: { localChecksum: 'local-hash', status: 'pending_push' },
      replicaPatch: {
        deviceId: 'device-1',
        localPath: 'C:\\notes\\linked.md',
        linkState: 'linked',
        localChecksum: 'local-hash',
      },
    });

    expect(useSyncStore.getState().getReplica('doc-link-transaction')).toMatchObject({
      deviceId: 'device-1',
      localPath: 'C:\\notes\\linked.md',
      linkState: 'linked',
    });
    expect(queueFor('doc-link-transaction')).toHaveLength(1);
  });

  it('keeps an in-flight mutation when a newer snapshot is deduplicated', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-in-flight',
      type: 'upsert',
      payload: { content: 'first', checksum: 'hash-first' },
      baseRev: 2,
      mutationId: 'mutation-1',
      dedupeKey: 'upsert',
    });

    expect(store.claimReadyMutation()?.mutationId).toBe('mutation-1');

    useSyncStore.getState().enqueueMutation({
      fileId: 'doc-in-flight',
      type: 'upsert',
      payload: { content: 'second', checksum: 'hash-second' },
      baseRev: 2,
      mutationId: 'mutation-2',
      dedupeKey: 'upsert',
    });

    expect(queueFor('doc-in-flight')).toEqual([
      expect.objectContaining({
        mutationId: 'mutation-1',
        status: 'processing',
        payload: expect.objectContaining({ content: 'first' }),
      }),
      expect.objectContaining({
        mutationId: 'mutation-2',
        status: 'pending',
        payload: expect.objectContaining({ content: 'second' }),
      }),
    ]);
    expect(useSyncStore.getState().getReadyMutation()).toBeNull();
  });

  it('rebases only pending successors after the in-flight mutation is acknowledged', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-rebase',
      type: 'upsert',
      payload: { checksum: 'hash-first' },
      baseRev: 7,
      mutationId: 'rebase-1',
      dedupeKey: 'upsert',
    });
    store.claimReadyMutation();
    useSyncStore.getState().enqueueMutation({
      fileId: 'doc-rebase',
      type: 'upsert',
      payload: { checksum: 'hash-second' },
      baseRev: 7,
      mutationId: 'rebase-2',
      dedupeKey: 'upsert',
    });

    useSyncStore.getState().rebasePendingMutations('doc-rebase', 8);

    const [inFlight, successor] = queueFor('doc-rebase');
    expect(inFlight).toMatchObject({
      mutationId: 'rebase-1',
      status: 'processing',
      baseRev: 7,
    });
    expect(successor).toMatchObject({
      mutationId: 'rebase-2',
      status: 'pending',
      baseRev: 8,
    });

    useSyncStore.getState().completeMutation('rebase-1');
    expect(useSyncStore.getState().getReadyMutation()).toMatchObject({
      mutationId: 'rebase-2',
      baseRev: 8,
    });
  });

  it('does not return blocked conflict work until it is explicitly retried', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-blocked',
      type: 'upsert',
      payload: { checksum: 'blocked-hash' },
      baseRev: 3,
      mutationId: 'blocked-1',
      dedupeKey: 'upsert',
    });
    store.blockMutation('blocked-1', { kind: 'conflict', lastError: 'revision conflict' });

    expect(useSyncStore.getState().getReadyMutation()).toBeNull();
    useSyncStore.getState().retryBlockedMutations();
    expect(queueFor('doc-blocked')[0]).toMatchObject({
      mutationId: 'blocked-1',
      status: 'blocked',
      errorKind: 'conflict',
    });
    expect(useSyncStore.getState().getReadyMutation()).toBeNull();

    useSyncStore.getState().retryMutation('blocked-1', { retryAt: Date.now() - 1 });
    expect(useSyncStore.getState().getReadyMutation()?.mutationId).toBe('blocked-1');
  });

  it('splits the overloaded v3 checksum into local and acknowledged server checksums', () => {
    const migrated = migratePersistedState({
      stateSchemaVersion: 3,
      docs: {
        [`${USER_ID}::doc-pending`]: {
          fileId: 'doc-pending',
          ownerUserId: USER_ID,
          checksum: 'pending-local-hash',
        },
        [`${USER_ID}::doc-clean`]: {
          fileId: 'doc-clean',
          ownerUserId: USER_ID,
          checksum: 'acknowledged-server-hash',
        },
      },
      queue: [{
        id: 'pending-checksum-mutation',
        mutationId: 'pending-checksum-mutation',
        fileId: 'doc-pending',
        type: 'upsert',
        payload: { checksum: 'pending-local-hash' },
        baseRev: 5,
        status: 'pending',
        ownerUserId: USER_ID,
      }],
      conflicts: [],
    });

    expect(migrated.docs[`${USER_ID}::doc-pending`]).toMatchObject({
      localChecksum: 'pending-local-hash',
      serverChecksum: '',
    });
    expect(migrated.docs[`${USER_ID}::doc-clean`]).toMatchObject({
      localChecksum: 'acknowledged-server-hash',
      serverChecksum: 'acknowledged-server-hash',
    });
  });

  it('keeps the conflict barrier when another local save arrives', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-conflict-save',
      type: 'upsert',
      payload: { content: 'before', checksum: 'before-hash' },
      baseRev: 2,
      mutationId: 'conflict-old',
      dedupeKey: 'upsert',
    });
    store.recordConflict(
      'doc-conflict-save',
      { lastKnownServerRev: 3, serverChecksum: 'remote-hash' },
      {
        fileId: 'doc-conflict-save',
        localContent: 'before',
        remoteContent: 'remote',
        remoteDoc: { fileId: 'doc-conflict-save', rev: 3 },
      },
    );

    const replacement = useSyncStore.getState().enqueueMutation({
      fileId: 'doc-conflict-save',
      type: 'upsert',
      payload: { content: 'after', checksum: 'after-hash' },
      baseRev: 3,
      mutationId: 'conflict-new',
      dedupeKey: 'upsert',
    });
    useSyncStore.getState().updateConflictLocal(
      'doc-conflict-save',
      'after',
      { localChecksum: 'after-hash' },
    );

    expect(replacement).toBeNull();
    expect(queueFor('doc-conflict-save')).toEqual([
      expect.objectContaining({
        mutationId: 'conflict-old',
        status: 'blocked',
        errorKind: 'conflict',
      }),
    ]);
    expect(useSyncStore.getState().listConflicts()).toEqual([
      expect.objectContaining({ localContent: 'after', remoteContent: 'remote' }),
    ]);
    expect(useSyncStore.getState().getReadyMutation()).toBeNull();
  });

  it('atomically replaces a conflict with one newly based resolution mutation', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-resolve-local',
      type: 'upsert',
      payload: { checksum: 'old-local' },
      baseRev: 4,
      mutationId: 'resolve-old',
    });
    store.recordConflict(
      'doc-resolve-local',
      { lastKnownServerRev: 5, serverChecksum: 'remote' },
      {
        fileId: 'doc-resolve-local',
        localContent: 'chosen local',
        remoteContent: 'remote',
      },
    );

    const mutationId = useSyncStore.getState().replaceConflictWithMutation({
      fileId: 'doc-resolve-local',
      type: 'upsert',
      payload: { content: 'chosen local', checksum: 'chosen-local-hash' },
      baseRev: 5,
      mutationId: 'resolve-new',
      docPatch: { localChecksum: 'chosen-local-hash', status: 'pending_push' },
    });

    expect(mutationId).toBe('resolve-new');
    expect(useSyncStore.getState().listConflicts()).toEqual([]);
    expect(queueFor('doc-resolve-local')).toEqual([
      expect.objectContaining({
        mutationId: 'resolve-new',
        baseRev: 5,
        status: 'pending',
      }),
    ]);
    expect(useSyncStore.getState().getDoc('doc-resolve-local')).toMatchObject({
      localChecksum: 'chosen-local-hash',
      status: 'pending_push',
    });
  });

  it('drops content work without discarding a pending path binding', () => {
    const store = useSyncStore.getState();
    store.enqueueMutation({
      fileId: 'doc-renamed',
      type: 'bind_path',
      payload: { devicePath: 'C:\\docs\\new.md' },
      baseRev: 7,
      mutationId: 'bind-new-path',
      dedupeKey: 'bind_path',
    });
    store.enqueueMutation({
      fileId: 'doc-renamed',
      type: 'upsert',
      payload: { checksum: 'same-as-remote' },
      baseRev: 7,
      mutationId: 'content-already-remote',
      dedupeKey: 'upsert',
    });

    useSyncStore.getState().dropContentMutationsForFile('doc-renamed');

    expect(queueFor('doc-renamed')).toEqual([
      expect.objectContaining({ mutationId: 'bind-new-path', type: 'bind_path' }),
    ]);
  });

  it('keeps a staged local deletion non-runnable until the filesystem step commits', () => {
    const store = useSyncStore.getState();
    store.upsertDoc('doc-staged-delete', {
      localPath: 'C:\\docs\\staged.md',
      enrolled: true,
      status: 'synced',
    });
    const previousDoc = store.getDoc('doc-staged-delete');
    store.enqueueMutation({
      fileId: 'doc-staged-delete',
      type: 'delete',
      mutationId: 'staged-delete',
      payload: {},
      status: 'staged',
      errorKind: 'local_delete_pending',
      docPatch: { enrolled: false, status: 'deleting_local' },
    });

    expect(useSyncStore.getState().getReadyMutation()).toBeNull();
    expect(useSyncStore.getState().getNextRetryAt()).toBeNull();
    expect(useSyncStore.getState().enqueueMutation({
      fileId: 'doc-staged-delete',
      type: 'upsert',
      mutationId: 'must-not-resurrect',
      payload: { checksum: 'stale-disk-content' },
    })).toBeNull();
    expect(queueFor('doc-staged-delete')).toHaveLength(1);
    expect(useSyncStore.getState().activateStagedMutation('staged-delete', {
      deleted: true,
      localPath: '',
      status: 'pending_push',
    })).toBe(true);
    expect(useSyncStore.getState().getReadyMutation()).toMatchObject({
      mutationId: 'staged-delete',
      type: 'delete',
    });

    useSyncStore.getState().clearAllSyncState();
    useSyncStore.getState().upsertDoc('doc-staged-delete', previousDoc);
    useSyncStore.getState().enqueueMutation({
      fileId: 'doc-staged-delete',
      type: 'delete',
      mutationId: 'staged-abort',
      payload: {},
      status: 'staged',
      docPatch: { enrolled: false },
    });
    expect(useSyncStore.getState().abortStagedMutation('staged-abort', previousDoc)).toBe(true);
    expect(queueFor('doc-staged-delete')).toEqual([]);
    expect(useSyncStore.getState().getDoc('doc-staged-delete')).toMatchObject({
      localPath: 'C:\\docs\\staged.md',
      enrolled: true,
    });
  });
});
