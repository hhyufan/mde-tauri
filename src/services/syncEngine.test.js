import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import useAuthStore from '@store/useAuthStore';
import useConfigStore from '@store/useConfigStore';
import useDeviceStore from '@store/useDeviceStore';
import useEditorStore from '@store/useEditorStore';
import useExternalDocsStore from '@store/useExternalDocsStore';
import useFileIdStore from '@store/useFileIdStore';
import useFileStore from '@store/useFileStore';
import useSyncStore, {
  waitForSyncStatePersistence,
  waitForSyncStoreHydration,
} from '@store/useSyncStore';
import { SyncEngine } from './syncEngine';
import { encodeSyncBody } from './sync/contentCodec';

const USER_ID = 'sync-engine-test-user';

function createTransport(overrides = {}) {
  return {
    getConfig: vi.fn(async () => ({ protocolVersion: 3, updatedAt: 0 })),
    putConfig: vi.fn(async () => ({})),
    getChanges: vi.fn(async (checkpoint) => ({
      changes: [],
      checkpoint,
      hasMore: false,
    })),
    getFile: vi.fn(async () => null),
    putFile: vi.fn(async () => ({})),
    bindPath: vi.fn(async () => null),
    deleteFile: vi.fn(async () => ({})),
    ...overrides,
  };
}

function enqueueUpsert({
  fileId,
  mutationId,
  baseRev,
  content = 'local content',
  checksum = 'local-checksum',
}) {
  useSyncStore.getState().enqueueMutation({
    fileId,
    type: 'upsert',
    mutationId,
    baseRev,
    dedupeKey: 'upsert',
    payload: {
      fileName: `${fileId}.md`,
      content,
      compressed: false,
      size: content.length,
      checksum,
      encoding: 'UTF-8',
      lineEnding: 'LF',
      devicePath: `C:\\docs\\${fileId}.md`,
    },
  });
}

describe('SyncEngine safety invariants', () => {
  beforeAll(async () => {
    await waitForSyncStoreHydration();
  });

  beforeEach(async () => {
    // Reset subscribed stores while logged out so the module singleton cannot
    // schedule an unrelated config sync during this test's setup.
    useAuthStore.setState({
      user: null,
      token: null,
      isLoggedIn: false,
      loading: false,
    });
    useConfigStore.setState({ syncEnabled: true, configUpdatedAt: 0 });
    useDeviceStore.setState({ deviceId: 'sync-engine-test-device' });
    useEditorStore.setState({
      tabs: [],
      tabRenderList: [],
      activeTabId: null,
      uiStateUpdatedAt: 0,
    });
    useFileStore.setState({
      bookmarkedPaths: [],
      recentFiles: [],
      currentDir: '',
    });
    useFileIdStore.getState().reset();
    useExternalDocsStore.getState().reset();
    useSyncStore.getState().clearAllSyncState();
    await waitForSyncStatePersistence();

    useAuthStore.setState({
      user: { id: USER_ID, email: 'sync-engine@example.test' },
      token: 'test-token',
      isLoggedIn: true,
      loading: false,
    });
  });

  afterAll(async () => {
    useAuthStore.setState({
      user: null,
      token: null,
      isLoggedIn: false,
      loading: false,
    });
    useSyncStore.getState().clearAllSyncState();
    useExternalDocsStore.getState().reset();
    useFileIdStore.getState().reset();
    await waitForSyncStatePersistence();
  });

  it('treats an older protocol marker as metadata and never calls a destructive reset', async () => {
    const transport = createTransport({
      getConfig: vi.fn(async () => ({ protocolVersion: 2, updatedAt: 10 })),
    });
    const engine = new SyncEngine({ transport, autoSubscribe: false });
    enqueueUpsert({
      fileId: 'doc-protocol',
      mutationId: 'protocol-mutation',
      baseRev: 1,
    });

    await expect(engine.ensureRemoteProtocol()).resolves.toMatchObject({ protocolVersion: 2 });

    expect(Object.hasOwn(transport, 'reset')).toBe(false);
    expect(transport.getConfig).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().listQueue()).toEqual([
      expect.objectContaining({ mutationId: 'protocol-mutation', status: 'pending' }),
    ]);
  });

  it('sends a processing mutation with its immutable original base revision', async () => {
    const putFile = vi.fn(async () => ({
      rev: 5,
      checksum: 'local-checksum',
      contentHash: 'local-checksum',
    }));
    const engine = new SyncEngine({
      transport: createTransport({ putFile }),
      autoSubscribe: false,
    });
    useSyncStore.getState().upsertDoc('doc-base-rev', {
      rev: 40,
      lastKnownServerRev: 40,
      serverChecksum: 'newer-server-checksum',
    });
    enqueueUpsert({
      fileId: 'doc-base-rev',
      mutationId: 'base-rev-mutation',
      baseRev: 4,
    });
    const processing = useSyncStore.getState().claimReadyMutation();

    await expect(engine.processMutation(processing, USER_ID)).resolves.toMatchObject({
      outcome: 'success',
    });

    expect(putFile).toHaveBeenCalledWith(
      'doc-base-rev',
      expect.objectContaining({
        mutationId: 'base-rev-mutation',
        baseRev: 4,
      }),
    );
  });

  it('does not advance the pull checkpoint when remote content fails integrity validation', async () => {
    const beforeCheckpoint = { mode: 'v3', value: 'cursor-before' };
    const afterCheckpoint = { mode: 'v3', value: 'cursor-after' };
    useSyncStore.getState().setCheckpoint(beforeCheckpoint);
    await waitForSyncStatePersistence();

    const transport = createTransport({
      getChanges: vi.fn(async () => ({
        changes: [{ fileId: 'doc-corrupt', rev: 1, deleted: false }],
        checkpoint: afterCheckpoint,
        hasMore: false,
      })),
      getFile: vi.fn(async () => ({
        fileId: 'doc-corrupt',
        fileName: 'doc-corrupt.md',
        rev: 1,
        content: 'tampered content',
        compressed: false,
        size: 999,
        checksum: 'untrusted-checksum',
        deviceBindings: {},
      })),
    });
    const engine = new SyncEngine({ transport, autoSubscribe: false });

    await expect(engine.pullRemoteChanges(USER_ID)).rejects.toMatchObject({
      code: 'SYNC_INTEGRITY_ERROR',
    });

    expect(useSyncStore.getState().getCheckpoint()).toEqual(beforeCheckpoint);
    expect(useSyncStore.getState().getDoc('doc-corrupt')).toBeNull();
    expect(useExternalDocsStore.getState().get('doc-corrupt')).toBeNull();
  });

  it('blocks a permanent 413 mutation instead of scheduling a retry', async () => {
    const payloadTooLarge = Object.assign(new Error('payload too large'), {
      response: {
        status: 413,
        data: { message: 'payload too large' },
      },
    });
    const putFile = vi.fn(async () => {
      throw payloadTooLarge;
    });
    const engine = new SyncEngine({
      transport: createTransport({ putFile }),
      autoSubscribe: false,
    });
    enqueueUpsert({
      fileId: 'doc-too-large',
      mutationId: 'too-large-mutation',
      baseRev: 3,
    });

    await expect(engine.processQueue(USER_ID)).resolves.toMatchObject({ outcome: 'blocked' });

    expect(putFile).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().listQueue()).toEqual([
      expect.objectContaining({
        mutationId: 'too-large-mutation',
        status: 'blocked',
        errorKind: 'payload_too_large',
        retryCount: 0,
      }),
    ]);
    expect(useSyncStore.getState().getReadyMutation()).toBeNull();
    expect(engine.retryTimer).toBeNull();
  });

  it('does not acknowledge an upsert when the server returns a different checksum', async () => {
    const engine = new SyncEngine({
      transport: createTransport({
        putFile: vi.fn(async () => ({ rev: 2, checksum: 'different-server-hash' })),
      }),
      autoSubscribe: false,
    });
    enqueueUpsert({
      fileId: 'doc-bad-ack',
      mutationId: 'bad-ack-mutation',
      baseRev: 1,
      checksum: 'expected-local-hash',
    });

    await expect(engine.processQueue(USER_ID)).resolves.toMatchObject({ outcome: 'blocked' });

    expect(useSyncStore.getState().listQueue()).toEqual([
      expect.objectContaining({
        mutationId: 'bad-ack-mutation',
        status: 'blocked',
        errorKind: 'integrity_error',
      }),
    ]);
    expect(useSyncStore.getState().getDoc('doc-bad-ack')?.lastKnownServerRev || 0).toBe(0);
  });

  it('coalesces concurrent fullSync callers while preserving a requested follow-up cycle', async () => {
    let finishFirstCycle;
    const firstCycle = new Promise((resolve) => {
      finishFirstCycle = resolve;
    });
    const engine = new SyncEngine({
      transport: createTransport(),
      autoSubscribe: false,
    });
    engine.runSyncCycle = vi.fn()
      .mockImplementationOnce(() => firstCycle)
      .mockResolvedValue({ outcome: 'success' });

    const first = engine.fullSync();
    const second = engine.fullSync();

    expect(second).toBe(first);
    expect(engine.runSyncCycle).toHaveBeenCalledTimes(1);

    finishFirstCycle({ outcome: 'success' });
    await expect(first).resolves.toMatchObject({ outcome: 'success' });
    expect(engine.runSyncCycle).toHaveBeenCalledTimes(2);
  });

  it('turns keep-local conflict resolution into a fresh durable mutation', async () => {
    const engine = new SyncEngine({ transport: createTransport(), autoSubscribe: false });
    const fileId = 'doc-keep-local';
    const path = 'C:\\docs\\keep-local.md';
    useFileStore.getState().toggleBookmark(path);
    useFileIdStore.getState().bind(path, fileId);
    useSyncStore.getState().upsertDoc(fileId, {
      localPath: path,
      name: 'keep-local.md',
      lastKnownServerRev: 8,
      serverChecksum: 'remote-hash',
      localChecksum: 'old-local-hash',
      enrolled: true,
    });
    enqueueUpsert({
      fileId,
      mutationId: 'keep-local-old',
      baseRev: 7,
      content: 'old local',
      checksum: 'old-local-hash',
    });
    useSyncStore.getState().recordConflict(
      fileId,
      { lastKnownServerRev: 8, serverChecksum: 'remote-hash' },
      {
        fileId,
        localContent: 'chosen local',
        remoteContent: 'remote content',
        remoteDoc: { fileId, fileName: 'keep-local.md', rev: 8 },
      },
    );
    useConfigStore.setState({ syncEnabled: false });

    await expect(engine.resolveConflict(fileId, 'local')).resolves.toMatchObject({ ok: true });

    expect(useSyncStore.getState().listConflicts()).toEqual([]);
    expect(useSyncStore.getState().listQueue()).toEqual([
      expect.objectContaining({
        fileId,
        type: 'upsert',
        baseRev: 8,
        status: 'pending',
        payload: expect.objectContaining({ content: 'chosen local' }),
      }),
    ]);
  });

  it('does not write an A-account edit into B when the account changes at an async boundary', async () => {
    const engine = new SyncEngine({ transport: createTransport(), autoSubscribe: false });
    const path = 'C:\\docs\\account-race.md';
    useFileStore.getState().toggleBookmark(path);

    const pending = engine.queueLocalUpsert(path, 'belongs to A', 'UTF-8', {
      source: 'bookmark-add',
    });
    useAuthStore.setState({
      user: { id: 'different-user' },
      token: 'different-token',
      isLoggedIn: true,
    });

    await expect(pending).rejects.toMatchObject({ code: 'SYNC_SESSION_CHANGED' });
    expect(useSyncStore.getState().listQueue()).toEqual([]);
    useAuthStore.setState({
      user: { id: USER_ID, email: 'sync-engine@example.test' },
      token: 'test-token',
      isLoggedIn: true,
    });
    expect(useSyncStore.getState().listQueue()).toEqual([]);
  });

  it('syncs Ctrl+S-style saves for an enrolled Explorer file and records this device path', async () => {
    const fileId = 'doc-device-path';
    const path = 'C:\\notes\\bound-cloud-file.md';
    const putFile = vi.fn(async (_id, payload) => ({
      rev: 2,
      checksum: payload.checksum,
      contentHash: payload.checksum,
    }));
    const engine = new SyncEngine({
      transport: createTransport({ putFile }),
      autoSubscribe: false,
    });
    useFileIdStore.getState().bind(path, fileId);
    useSyncStore.getState().upsertDoc(fileId, {
      localPath: path,
      enrolled: true,
      lastKnownServerRev: 1,
      status: 'synced',
    });
    useSyncStore.getState().upsertReplica(fileId, {
      deviceId: 'sync-engine-test-device',
      localPath: path,
      linkState: 'linked',
      baseRev: 1,
    });

    // Opening the path from Explorer re-registers metadata. It must preserve
    // remote enrollment even when bookmark UI state is absent.
    engine.registerLocalDocument(path, { name: 'bound-cloud-file.md' });
    const queued = await engine.queueLocalUpsert(path, 'saved with Ctrl+S', 'UTF-8', {
      name: 'bound-cloud-file.md',
      source: 'manual-save',
    });
    await engine.fullSync();

    expect(queued).toMatchObject({ ok: true, fileId, queued: true });
    expect(putFile).toHaveBeenCalledWith(fileId, expect.objectContaining({
      content: 'saved with Ctrl+S',
      deviceId: 'sync-engine-test-device',
      devicePath: path,
      baseRev: 1,
    }));
    expect(useSyncStore.getState().getDoc(fileId)).toMatchObject({
      localPath: path,
      enrolled: true,
      status: 'synced',
    });
  });

  it('uses the device replica—not a path bookmark—as the authoritative sync switch', async () => {
    const engine = new SyncEngine({ transport: createTransport(), autoSubscribe: false });
    const path = 'C:\\notes\\replica-controlled.md';
    useConfigStore.setState({ syncEnabled: false });

    const linked = await engine.linkLocalDocument(path, 'first snapshot', 'UTF-8', {
      name: 'replica-controlled.md',
    });
    expect(linked).toMatchObject({ ok: true, queued: true });
    expect(useFileStore.getState().isBookmarked(path)).toBe(false);
    expect(useSyncStore.getState().getReplica(linked.fileId)).toMatchObject({
      localPath: path,
      linkState: 'linked',
    });

    await expect(engine.stopTrackingLocal(path)).resolves.toMatchObject({ ok: true });
    expect(useSyncStore.getState().getReplica(linked.fileId)).toMatchObject({
      localPath: path,
      linkState: 'unlinked',
    });
    expect(useSyncStore.getState().listQueue()).toEqual([]);

    await expect(engine.queueLocalUpsert(path, 'local only now', 'UTF-8', {
      source: 'manual-save',
    })).resolves.toMatchObject({ ok: true, skipped: 'not-enrolled' });
  });

  it('checkpoints a large first sync page by page instead of replaying the whole backlog', async () => {
    const body = await encodeSyncBody('remote first-sync content');
    const pages = [25, 25, 10].map((count, pageIndex) => ({
      changes: Array.from({ length: count }, (_, index) => ({
        fileId: `remote-${pageIndex}-${index}`,
        rev: 1,
        deleted: false,
      })),
      checkpoint: { mode: 'v3', value: `cursor-${pageIndex + 1}` },
      hasMore: pageIndex < 2,
    }));
    let pageIndex = 0;
    const transport = createTransport({
      getChanges: vi.fn(async () => pages[pageIndex++]),
      getFile: vi.fn(async (fileId) => ({
        fileId,
        fileName: `${fileId}.md`,
        rev: 1,
        ...body,
        deviceBindings: {},
      })),
    });
    const engine = new SyncEngine({ transport, autoSubscribe: false });

    await engine.pullRemoteChanges(USER_ID);

    expect(transport.getChanges).toHaveBeenCalledTimes(3);
    expect(transport.getFile).toHaveBeenCalledTimes(60);
    expect(useSyncStore.getState().getCheckpoint()).toEqual({
      mode: 'v3',
      value: 'cursor-3',
    });
    expect(useSyncStore.getState().listDocs()).toHaveLength(60);
    expect(useSyncStore.getState().listReplicas()).toHaveLength(0);
  });
});
