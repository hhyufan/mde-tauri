import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { normalizeCheckpoint } from '@/services/sync/changeProtocol';
import {
  getCurrentUserScopeId,
  isOwnedByUser,
  normalizeOwnerUserId,
} from './userScope';

// Wire capabilities and the local persisted representation evolve independently.
export const SYNC_PROTOCOL_VERSION = 3;
export const SYNC_STATE_SCHEMA_VERSION = 5;

let nativeSyncStorePromise = null;
let syncStateWriteChain = Promise.resolve();
let hydrationResult = null;
let resolveHydration;
const hydrationPromise = new Promise((resolve) => {
  resolveHydration = resolve;
});

function enqueueStorageWrite(operation) {
  const write = syncStateWriteChain.catch(() => {}).then(operation);
  syncStateWriteChain = write;
  return write;
}

export function waitForSyncStatePersistence() {
  return syncStateWriteChain;
}

const syncStateStorage = {
  async getItem(name) {
    if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
      return localStorage.getItem(name);
    }
    nativeSyncStorePromise ||= import('@tauri-apps/plugin-store')
      .then(({ load }) => load('sync-state.json'));
    const store = await nativeSyncStorePromise;
    const nativeValue = await store.get(name);
    if (nativeValue) return nativeValue;

    const legacy = localStorage.getItem(name);
    if (legacy) {
      await enqueueStorageWrite(async () => {
        await store.set(name, legacy);
        await store.set('migratedLocalStorageV2', true);
        await store.save();
        localStorage.removeItem(name);
      });
    }
    return legacy;
  },
  async setItem(name, value) {
    if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
      localStorage.setItem(name, value);
      return;
    }
    return enqueueStorageWrite(async () => {
      nativeSyncStorePromise ||= import('@tauri-apps/plugin-store')
        .then(({ load }) => load('sync-state.json'));
      const store = await nativeSyncStorePromise;
      await store.set(name, value);
      await store.save();
    });
  },
  async removeItem(name) {
    if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
      localStorage.removeItem(name);
      return;
    }
    return enqueueStorageWrite(async () => {
      nativeSyncStorePromise ||= import('@tauri-apps/plugin-store')
        .then(({ load }) => load('sync-state.json'));
      const store = await nativeSyncStorePromise;
      await store.delete(name);
      await store.save();
    });
  },
};

function scopedDocKey(fileId, ownerUserId = getCurrentUserScopeId()) {
  return `${normalizeOwnerUserId(ownerUserId)}::${fileId}`;
}

function listOwned(values, ownerUserId = getCurrentUserScopeId()) {
  return (values || []).filter((item) => isOwnedByUser(item?.ownerUserId, ownerUserId));
}

function listOwnedDocs(docs, ownerUserId = getCurrentUserScopeId()) {
  return Object.values(docs || {}).filter((doc) => isOwnedByUser(doc?.ownerUserId, ownerUserId));
}

function newMutationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function activeMutation(item) {
  return ['staged', 'pending', 'processing', 'blocked'].includes(item?.status);
}

function selectMutationHeads(queue, ownerUserId) {
  const ordered = listOwned(queue, ownerUserId)
    .filter(activeMutation)
    .sort((left, right) =>
      Number(left.sequence || 0) - Number(right.sequence || 0)
      || Number(left.enqueuedAt || 0) - Number(right.enqueuedAt || 0)
      || String(left.mutationId).localeCompare(String(right.mutationId))
    );
  const headByFile = new Map();
  for (const item of ordered) {
    if (!headByFile.has(item.fileId)) headByFile.set(item.fileId, item);
  }
  return [...headByFile.values()];
}

function selectReadyMutation(queue, ownerUserId, now = Date.now()) {
  return selectMutationHeads(queue, ownerUserId)
    .filter((item) => item.status === 'pending' && Number(item.nextRetryAt || 0) <= now)
    .sort((left, right) =>
      Number(left.nextRetryAt || 0) - Number(right.nextRetryAt || 0)
      || Number(left.sequence || 0) - Number(right.sequence || 0)
      || Number(left.enqueuedAt || 0) - Number(right.enqueuedAt || 0)
    )[0] || null;
}

function migratePersistedState(persisted = {}) {
  const now = Date.now();
  let queue = (persisted.queue || []).map((item, index) => {
    const payload = { ...(item?.payload || {}) };
    delete payload.rawContent;
    const id = item?.mutationId || item?.id || newMutationId();
    return {
      ...item,
      id,
      mutationId: id,
      payload,
      retryCount: Number(item?.retryCount || 0),
      nextRetryAt: item?.status === 'processing' ? now : Number(item?.nextRetryAt || now),
      status: item?.status === 'processing' ? 'pending' : item?.status || 'pending',
      enqueuedAt: Number(item?.enqueuedAt || now + index),
      sequence: Number(item?.sequence || index + 1),
      ownerUserId: normalizeOwnerUserId(item?.ownerUserId),
      recoveredAt: item?.status === 'processing' ? now : item?.recoveredAt,
    };
  });

  const pendingByDoc = new Map();
  for (const item of queue) {
    if (item.type !== 'upsert' || !activeMutation(item)) continue;
    pendingByDoc.set(scopedDocKey(item.fileId, item.ownerUserId), item);
  }
  const docs = Object.fromEntries(Object.entries(persisted.docs || {}).map(([key, doc]) => {
    const pending = pendingByDoc.get(scopedDocKey(doc?.fileId, doc?.ownerUserId));
    const pendingChecksum = pending?.payload?.checksum || '';
    const inferredServerChecksum = doc?.serverChecksum
      ?? (pendingChecksum && pendingChecksum === doc?.checksum ? '' : doc?.checksum || '');
    return [key, {
      ...doc,
      serverChecksum: inferredServerChecksum,
      localChecksum: doc?.localChecksum || pendingChecksum || doc?.checksum || '',
      enrolled: doc?.enrolled ?? Boolean(doc?.localPath),
      ownerUserId: normalizeOwnerUserId(doc?.ownerUserId),
    }];
  }));
  const replicas = Object.fromEntries(Object.entries(persisted.replicas || {}).map(([key, replica]) => [
    key,
    {
      ...replica,
      ownerUserId: normalizeOwnerUserId(replica?.ownerUserId),
      linkState: replica?.linkState === 'linked' ? 'linked' : 'unlinked',
    },
  ]));
  // v4 and older encoded this device's participation inside the document
  // mirror. Convert only records with a real local path; cloud-only documents
  // remain catalog entries and must not auto-enrol a new device.
  for (const doc of Object.values(docs)) {
    if (!doc?.fileId || !doc?.localPath) continue;
    const key = scopedDocKey(doc.fileId, doc.ownerUserId);
    if (replicas[key]) continue;
    replicas[key] = {
      fileId: doc.fileId,
      ownerUserId: normalizeOwnerUserId(doc.ownerUserId),
      deviceId: doc.deviceId || '',
      localPath: doc.localPath,
      linkState: doc.enrolled === false ? 'unlinked' : 'linked',
      baseRev: Number(doc.lastKnownServerRev || doc.rev || 0),
      baseChecksum: doc.serverChecksum || '',
      localChecksum: doc.localChecksum || '',
      migratedAt: now,
    };
  }

  const checkpoints = { ...(persisted.checkpoints || {}) };
  for (const [ownerUserId, cursor] of Object.entries(persisted.cursors || {})) {
    if (!checkpoints[ownerUserId]) checkpoints[ownerUserId] = normalizeCheckpoint(cursor);
  }

  const lastSyncErrors = { ...(persisted.lastSyncErrors || {}) };
  const lastSuccessfulSyncAts = { ...(persisted.lastSuccessfulSyncAts || {}) };
  if (persisted.lastSyncError && Object.keys(lastSyncErrors).length === 0) {
    lastSyncErrors.guest = persisted.lastSyncError;
  }
  if (persisted.lastSuccessfulSyncAt && Object.keys(lastSuccessfulSyncAts).length === 0) {
    lastSuccessfulSyncAts.guest = persisted.lastSuccessfulSyncAt;
  }
  const conflicts = (persisted.conflicts || []).map((item) => ({
    ...item,
    ownerUserId: normalizeOwnerUserId(item?.ownerUserId),
  }));
  const conflictKeys = new Set(conflicts.map((item) =>
    scopedDocKey(item.fileId, item.ownerUserId)
  ));
  // Older builds persisted conflict doc/queue/list in separate writes. If only
  // the blocked operation survived, retry its immutable baseRev so the server
  // can return a fresh 409 body and reconstruct the missing dialog safely.
  queue = queue.map((item) => (
    item.status === 'blocked'
      && item.errorKind === 'conflict'
      && !conflictKeys.has(scopedDocKey(item.fileId, item.ownerUserId))
      ? {
          ...item,
          status: 'pending',
          errorKind: 'recovered_conflict',
          nextRetryAt: now,
          recoveredAt: now,
        }
      : item
  ));

  return {
    ...persisted,
    stateSchemaVersion: SYNC_STATE_SCHEMA_VERSION,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    docs,
    replicas,
    queue,
    checkpoints,
    localResetDoneScopes: persisted.localResetDoneScopes || {},
    lastSyncErrors,
    lastSuccessfulSyncAts,
    conflicts,
  };
}

const initialState = {
  stateSchemaVersion: SYNC_STATE_SCHEMA_VERSION,
  protocolVersion: SYNC_PROTOCOL_VERSION,
  localResetDone: false,
  localResetDoneScopes: {},
  docs: {},
  replicas: {},
  queue: [],
  conflicts: [],
  cursor: '',
  cursors: {},
  checkpoints: {},
  lastSyncError: null,
  lastSuccessfulSyncAt: 0,
  lastSyncErrors: {},
  lastSuccessfulSyncAts: {},
};

const useSyncStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      markLocalResetDone: () => set((state) => ({
        localResetDone: true,
        localResetDoneScopes: {
          ...(state.localResetDoneScopes || {}),
          [getCurrentUserScopeId()]: true,
        },
      })),
      isLocalResetDone: () => Boolean(get().localResetDoneScopes?.[getCurrentUserScopeId()]),

      clearAllSyncState: () => set({ ...initialState }),

      setCheckpoint: (checkpoint) => set((state) => {
        const ownerUserId = getCurrentUserScopeId();
        const normalized = normalizeCheckpoint(checkpoint);
        return {
          checkpoint: normalized,
          checkpoints: { ...(state.checkpoints || {}), [ownerUserId]: normalized },
          cursor: normalized.value,
          cursors: { ...(state.cursors || {}), [ownerUserId]: normalized.value },
        };
      }),
      getCheckpoint: () => {
        const ownerUserId = getCurrentUserScopeId();
        return normalizeCheckpoint(
          get().checkpoints?.[ownerUserId]
          || get().cursors?.[ownerUserId]
          || (ownerUserId === 'guest' ? get().cursor || '' : ''),
        );
      },
      setCursor: (cursor) => get().setCheckpoint(cursor),
      getCursor: () => get().getCheckpoint().value,

      setLastSyncError: (error) => set((state) => {
        const ownerUserId = getCurrentUserScopeId();
        const normalized = error ? { ...error, at: error.at || Date.now() } : null;
        return {
          lastSyncError: normalized,
          lastSyncErrors: { ...(state.lastSyncErrors || {}), [ownerUserId]: normalized },
        };
      }),
      getLastSyncError: () => get().lastSyncErrors?.[getCurrentUserScopeId()] || null,
      markSyncSuccessful: () => set((state) => {
        const ownerUserId = getCurrentUserScopeId();
        const timestamp = Date.now();
        return {
          lastSuccessfulSyncAt: timestamp,
          lastSuccessfulSyncAts: {
            ...(state.lastSuccessfulSyncAts || {}),
            [ownerUserId]: timestamp,
          },
          lastSyncError: null,
          lastSyncErrors: { ...(state.lastSyncErrors || {}), [ownerUserId]: null },
        };
      }),
      getLastSuccessfulSyncAt: () => Number(
        get().lastSuccessfulSyncAts?.[getCurrentUserScopeId()] || 0,
      ),

      getDoc: (fileId) => get().docs[scopedDocKey(fileId)] || null,
      findDocByPath: (localPath) => {
        if (!localPath) return null;
        return listOwnedDocs(get().docs).find((doc) => doc.localPath === localPath) || null;
      },
      listDocs: () => listOwnedDocs(get().docs),

      getReplica: (fileId) => get().replicas[scopedDocKey(fileId)] || null,
      findReplicaByPath: (localPath) => {
        if (!localPath) return null;
        return listOwned(Object.values(get().replicas || {}))
          .find((replica) => replica.localPath === localPath) || null;
      },
      listReplicas: () => listOwned(Object.values(get().replicas || {})),
      upsertReplica: (fileId, patch) => {
        if (!fileId) return;
        const ownerUserId = getCurrentUserScopeId();
        const key = scopedDocKey(fileId, ownerUserId);
        set((state) => ({
          replicas: {
            ...(state.replicas || {}),
            [key]: {
              ...(state.replicas?.[key] || {
                fileId,
                linkState: 'unlinked',
                localPath: '',
                baseRev: 0,
                baseChecksum: '',
                localChecksum: '',
              }),
              ...patch,
              fileId,
              ownerUserId,
              updatedAt: patch?.updatedAt || Date.now(),
            },
          },
        }));
      },
      upsertDocumentAndReplica: (fileId, docPatch = {}, replicaPatch = null) => {
        if (!fileId) return;
        const ownerUserId = getCurrentUserScopeId();
        const key = scopedDocKey(fileId, ownerUserId);
        set((state) => {
          const next = {
            docs: {
              ...state.docs,
              [key]: {
                ...(state.docs[key] || {
                  fileId,
                  rev: 0,
                  lastKnownServerRev: 0,
                  serverChecksum: '',
                  localChecksum: '',
                  deleted: false,
                  status: 'idle',
                }),
                ...docPatch,
                fileId,
                ownerUserId,
              },
            },
          };
          if (replicaPatch) {
            next.replicas = {
              ...(state.replicas || {}),
              [key]: {
                ...(state.replicas?.[key] || {
                  fileId,
                  linkState: 'unlinked',
                  localPath: '',
                  baseRev: 0,
                  baseChecksum: '',
                  localChecksum: '',
                }),
                ...replicaPatch,
                fileId,
                ownerUserId,
                updatedAt: replicaPatch.updatedAt || Date.now(),
              },
            };
          }
          return next;
        });
      },

      upsertDoc: (fileId, patch) => {
        if (!fileId) return;
        const key = scopedDocKey(fileId);
        set((state) => ({
          docs: {
            ...state.docs,
            [key]: {
              ...(state.docs[key] || {
                fileId,
                rev: 0,
                lastKnownServerRev: 0,
                serverChecksum: '',
                localChecksum: '',
                deleted: false,
                status: 'idle',
              }),
              ...patch,
              fileId,
              ownerUserId: getCurrentUserScopeId(),
            },
          },
        }));
      },
      removeDoc: (fileId) => set((state) => {
        const docs = { ...state.docs };
        delete docs[scopedDocKey(fileId)];
        return { docs };
      }),
      bindLocalPath: (fileId, localPath, patch = {}) => {
        if (!fileId || !localPath) return;
        get().upsertDoc(fileId, { ...patch, localPath, deleted: false });
      },
      moveLocalPath: (oldPath, newPath, patch = {}) => {
        if (!oldPath || !newPath || oldPath === newPath) return;
        const fileId = listOwnedDocs(get().docs).find((doc) => doc.localPath === oldPath)?.fileId;
        if (fileId) get().bindLocalPath(fileId, newPath, patch);
      },
      markDeleted: (fileId, patch = {}) => get().upsertDoc(fileId, {
        ...patch,
        deleted: true,
        status: patch.status || 'deleted',
      }),
      hasPendingMutation: (fileId) => listOwned(get().queue)
        .some((item) => item.fileId === fileId && activeMutation(item)),
      hasPendingContentMutation: (fileId) => listOwned(get().queue)
        .some((item) =>
          item.fileId === fileId
          && ['upsert', 'delete'].includes(item.type)
          && activeMutation(item)
        ),
      hasPendingDelete: (fileId) => listOwned(get().queue)
        .some((item) => item.fileId === fileId && item.type === 'delete' && activeMutation(item)),
      hasMutation: (mutationId) => listOwned(get().queue)
        .some((item) => item.mutationId === mutationId),
      getPendingUpsertPayload: (fileId) => listOwned(get().queue)
        .filter((item) => item.fileId === fileId && item.type === 'upsert' && activeMutation(item))
        .sort((left, right) =>
          Number(right.sequence || 0) - Number(left.sequence || 0)
          || Number(right.enqueuedAt || 0) - Number(left.enqueuedAt || 0)
        )[0]
        ?.payload,

      enqueueMutation: ({
        fileId,
        type,
        payload,
        baseRev = 0,
        mutationId,
        dedupeKey,
        docPatch,
        replicaPatch,
        status: initialStatus = 'pending',
        errorKind: initialErrorKind = null,
      }) => {
        if (!fileId || !type) return null;
        const id = mutationId || newMutationId();
        const enqueuedAt = Date.now();
        let queued = false;
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          let queue = [...state.queue];
          const conflictBlocked = state.conflicts.some((item) =>
            isOwnedByUser(item?.ownerUserId, ownerUserId) && item.fileId === fileId
          ) || queue.some((item) =>
            isOwnedByUser(item?.ownerUserId, ownerUserId)
            && item.fileId === fileId
            && item.status === 'blocked'
            && item.errorKind === 'conflict'
          );
          const deleteBlocked = type !== 'delete' && queue.some((item) =>
            isOwnedByUser(item?.ownerUserId, ownerUserId)
            && item.fileId === fileId
            && item.type === 'delete'
            && activeMutation(item)
          );
          // A save that happens while the conflict dialog is open must not
          // silently remove the causal barrier and overwrite the remote side.
          if (conflictBlocked || deleteBlocked) return state;
          const sequence = listOwned(queue, ownerUserId).reduce(
            (max, item) => Math.max(max, Number(item.sequence || 0)),
            0,
          ) + 1;
          if (type === 'delete') {
            queue = queue.filter((item) => !(
              isOwnedByUser(item?.ownerUserId, ownerUserId)
              && item.fileId === fileId
              && item.status !== 'processing'
            ));
          } else if (dedupeKey) {
            queue = queue.filter((item) => !(
              isOwnedByUser(item?.ownerUserId, ownerUserId)
              && item.fileId === fileId
              && item.dedupeKey === dedupeKey
              && item.status !== 'processing'
            ));
          }
          queue.push({
            id,
            mutationId: id,
            fileId,
            type,
            payload,
            baseRev,
            retryCount: 0,
            nextRetryAt: enqueuedAt,
            status: initialStatus,
            errorKind: initialErrorKind,
            dedupeKey: dedupeKey || type,
            ownerUserId,
            enqueuedAt,
            sequence,
          });
          queued = true;
          const key = scopedDocKey(fileId, ownerUserId);
          const next = { queue };
          if (docPatch) {
            next.docs = {
              ...state.docs,
              [key]: {
                ...(state.docs[key] || {
                  fileId,
                  rev: 0,
                  lastKnownServerRev: 0,
                  serverChecksum: '',
                  localChecksum: '',
                  deleted: false,
                  status: 'idle',
                }),
                ...docPatch,
                fileId,
                ownerUserId,
              },
            };
          }
          if (replicaPatch) {
            next.replicas = {
              ...(state.replicas || {}),
              [key]: {
                ...(state.replicas?.[key] || {
                  fileId,
                  linkState: 'unlinked',
                  localPath: '',
                  baseRev: 0,
                  baseChecksum: '',
                  localChecksum: '',
                }),
                ...replicaPatch,
                fileId,
                ownerUserId,
                updatedAt: replicaPatch.updatedAt || enqueuedAt,
              },
            };
          }
          return next;
        });
        return queued ? id : null;
      },

      activateStagedMutation: (mutationId, docPatch = {}, replicaPatch = null) => {
        const ownerUserId = getCurrentUserScopeId();
        let activated = false;
        set((state) => {
          const item = state.queue.find((candidate) =>
            candidate.mutationId === mutationId
            && candidate.status === 'staged'
            && isOwnedByUser(candidate?.ownerUserId, ownerUserId)
          );
          if (!item) return state;
          const key = scopedDocKey(item.fileId, ownerUserId);
          activated = true;
          const next = {
            queue: state.queue.map((candidate) =>
              candidate === item
                ? {
                    ...candidate,
                    status: 'pending',
                    errorKind: null,
                    nextRetryAt: Date.now(),
                  }
                : candidate
            ),
            docs: {
              ...state.docs,
              [key]: {
                ...(state.docs[key] || { fileId: item.fileId }),
                ...docPatch,
                fileId: item.fileId,
                ownerUserId,
              },
            },
          };
          if (replicaPatch) {
            next.replicas = {
              ...(state.replicas || {}),
              [key]: {
                ...(state.replicas?.[key] || { fileId: item.fileId }),
                ...replicaPatch,
                fileId: item.fileId,
                ownerUserId,
                updatedAt: replicaPatch.updatedAt || Date.now(),
              },
            };
          }
          return next;
        });
        return activated;
      },
      abortStagedMutation: (mutationId, previousDoc = null, previousReplica = null) => {
        const ownerUserId = getCurrentUserScopeId();
        let aborted = false;
        set((state) => {
          const item = state.queue.find((candidate) =>
            candidate.mutationId === mutationId
            && candidate.status === 'staged'
            && isOwnedByUser(candidate?.ownerUserId, ownerUserId)
          );
          if (!item) return state;
          const docs = { ...state.docs };
          const replicas = { ...(state.replicas || {}) };
          const key = scopedDocKey(item.fileId, ownerUserId);
          if (previousDoc) docs[key] = { ...previousDoc, ownerUserId };
          else delete docs[key];
          if (previousReplica) replicas[key] = { ...previousReplica, ownerUserId };
          else if (replicas[key]?.linkState !== 'linked') delete replicas[key];
          aborted = true;
          return {
            queue: state.queue.filter((candidate) => candidate !== item),
            docs,
            replicas,
          };
        });
        return aborted;
      },

      replaceConflictWithMutation: ({
        fileId,
        type,
        payload,
        baseRev = 0,
        mutationId,
        dedupeKey,
        docPatch,
      }) => {
        if (!fileId || !type) return null;
        const ownerUserId = getCurrentUserScopeId();
        const id = mutationId || newMutationId();
        const enqueuedAt = Date.now();
        let replaced = false;
        set((state) => {
          const hasConflict = state.conflicts.some((item) =>
            item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
          );
          if (!hasConflict) return state;
          const sequence = listOwned(state.queue, ownerUserId).reduce(
            (max, item) => Math.max(max, Number(item.sequence || 0)),
            0,
          ) + 1;
          const key = scopedDocKey(fileId, ownerUserId);
          replaced = true;
          return {
            queue: [
              ...state.queue.filter((item) => !(
                item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
              )),
              {
                id,
                mutationId: id,
                fileId,
                type,
                payload,
                baseRev,
                retryCount: 0,
                nextRetryAt: enqueuedAt,
                status: 'pending',
                dedupeKey: dedupeKey || type,
                ownerUserId,
                enqueuedAt,
                sequence,
              },
            ],
            docs: {
              ...state.docs,
              [key]: {
                ...(state.docs[key] || { fileId }),
                ...(docPatch || {}),
                fileId,
                ownerUserId,
              },
            },
            conflicts: state.conflicts.filter((item) => !(
              item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
            )),
          };
        });
        return replaced ? id : null;
      },

      recordConflict: (fileId, docPatch, conflict) => {
        if (!fileId || !conflict) return;
        const ownerUserId = getCurrentUserScopeId();
        const key = scopedDocKey(fileId, ownerUserId);
        set((state) => ({
          docs: {
            ...state.docs,
            [key]: {
              ...(state.docs[key] || {
                fileId,
                rev: 0,
                lastKnownServerRev: 0,
                serverChecksum: '',
                localChecksum: '',
                deleted: false,
                status: 'idle',
              }),
              ...(docPatch || {}),
              fileId,
              ownerUserId,
              status: 'conflict',
            },
          },
          queue: state.queue.map((item) =>
            item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
              ? {
                  ...item,
                  status: 'blocked',
                  errorKind: 'conflict',
                  processingStartedAt: null,
                }
              : item
          ),
          conflicts: [
            ...state.conflicts.filter((item) => !(
              item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
            )),
            { ...conflict, fileId, ownerUserId, createdAt: conflict.createdAt || Date.now() },
          ],
        }));
      },
      updateConflictLocal: (fileId, localContent, docPatch = {}, conflictPatch = {}) => {
        if (!fileId) return false;
        const ownerUserId = getCurrentUserScopeId();
        const key = scopedDocKey(fileId, ownerUserId);
        let updated = false;
        set((state) => {
          if (!state.conflicts.some((item) =>
            item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
          )) return state;
          updated = true;
          return {
            docs: {
              ...state.docs,
              [key]: {
                ...(state.docs[key] || { fileId }),
                ...docPatch,
                fileId,
                ownerUserId,
                status: 'conflict',
              },
            },
            conflicts: state.conflicts.map((item) =>
              item.fileId === fileId && isOwnedByUser(item?.ownerUserId, ownerUserId)
                ? { ...item, ...conflictPatch, localContent, localUpdatedAt: Date.now() }
                : item
            ),
          };
        });
        return updated;
      },

      getReadyMutation: () => selectReadyMutation(get().queue, getCurrentUserScopeId()),
      claimReadyMutation: () => {
        let claimed = null;
        set((state) => {
          const item = selectReadyMutation(state.queue, getCurrentUserScopeId());
          if (!item) return state;
          claimed = { ...item, status: 'processing', processingStartedAt: Date.now() };
          return {
            queue: state.queue.map((candidate) =>
              candidate.mutationId === item.mutationId
                && isOwnedByUser(candidate?.ownerUserId, getCurrentUserScopeId())
                ? claimed
                : candidate
            ),
          };
        });
        return claimed;
      },
      getNextRetryAt: () => {
        const pending = selectMutationHeads(get().queue, getCurrentUserScopeId())
          .filter((item) => item.status === 'pending');
        return pending.length
          ? Math.min(...pending.map((item) => Number(item.nextRetryAt || 0)))
          : null;
      },
      markMutationProcessing: (mutationId) => set((state) => ({
        queue: state.queue.map((item) =>
          item.mutationId === mutationId
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
            ? { ...item, status: 'processing', processingStartedAt: Date.now() }
            : item
        ),
      })),
      recoverInterruptedMutations: ({ allScopes = false } = {}) => set((state) => ({
        queue: state.queue.map((item) =>
          item.status === 'processing'
            && (allScopes || isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId()))
            ? {
                ...item,
                status: 'pending',
                nextRetryAt: Date.now(),
                recoveredAt: Date.now(),
                processingStartedAt: null,
              }
            : item
        ),
      })),
      completeMutation: (mutationId) => set((state) => ({
        queue: state.queue.filter((item) => !(
          item.mutationId === mutationId
          && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
        )),
      })),
      retryMutation: (mutationId, { retryAt, lastError, kind } = {}) => set((state) => ({
        queue: state.queue.map((item) => {
          if (
            item.mutationId !== mutationId
            || !isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
          ) return item;
          return {
            ...item,
            status: 'pending',
            retryCount: Number(item.retryCount || 0) + 1,
            nextRetryAt: Number(retryAt || Date.now()),
            lastError: lastError || null,
            errorKind: kind || null,
            processingStartedAt: null,
          };
        }),
      })),
      failMutation: (mutationId, lastError) => get().retryMutation(mutationId, {
        retryAt: Date.now() + 2_000,
        lastError,
      }),
      blockMutation: (mutationId, { lastError, kind = 'request_error' } = {}) => set((state) => ({
        queue: state.queue.map((item) =>
          item.mutationId === mutationId
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
            ? {
                ...item,
                status: 'blocked',
                lastError: lastError || null,
                errorKind: kind,
                processingStartedAt: null,
              }
            : item
        ),
      })),
      retryBlockedMutations: () => set((state) => ({
        queue: state.queue.map((item) =>
          item.status === 'blocked'
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
            && item.errorKind !== 'conflict'
            ? { ...item, status: 'pending', nextRetryAt: Date.now() }
            : item
        ),
      })),
      rebasePendingMutations: (fileId, baseRev) => set((state) => ({
        queue: state.queue.map((item) =>
          item.fileId === fileId
            && item.status === 'pending'
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
            ? { ...item, baseRev: Number(baseRev || 0) }
            : item
        ),
      })),
      blockMutationsForFile: (fileId, reason = 'conflict') => set((state) => ({
        queue: state.queue.map((item) =>
          item.fileId === fileId
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
            ? { ...item, status: 'blocked', errorKind: reason, processingStartedAt: null }
            : item
        ),
      })),
      dropMutationsForFile: (fileId) => set((state) => ({
        queue: state.queue.filter((item) => !(
          item.fileId === fileId
          && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
        )),
      })),
      dropContentMutationsForFile: (fileId) => set((state) => ({
        queue: state.queue.filter((item) => !(
          item.fileId === fileId
          && ['upsert', 'delete'].includes(item.type)
          && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
        )),
      })),
      cancelQueuedMutationsForFile: (fileId) => set((state) => ({
        queue: state.queue.filter((item) => !(
          item.fileId === fileId
          && item.status !== 'processing'
          && item.errorKind !== 'conflict'
          && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
        )),
      })),

      addConflict: (conflict) => {
        if (!conflict?.fileId) return;
        const ownerUserId = getCurrentUserScopeId();
        set((state) => ({
          conflicts: [
            ...state.conflicts.filter((item) => !(
              item.fileId === conflict.fileId
              && isOwnedByUser(item?.ownerUserId, ownerUserId)
            )),
            { ...conflict, ownerUserId, createdAt: conflict.createdAt || Date.now() },
          ],
        }));
      },
      listConflicts: () => listOwned(get().conflicts),
      listQueue: () => listOwned(get().queue),
      resolveConflict: (fileId) => set((state) => ({
        conflicts: state.conflicts.filter((item) => !(
          item.fileId === fileId
          && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
        )),
      })),
    }),
    {
      name: 'mde-sync-state',
      version: SYNC_STATE_SCHEMA_VERSION,
      storage: createJSONStorage(() => syncStateStorage),
      migrate: (persisted) => migratePersistedState(persisted),
      merge: (persisted, current) => ({ ...current, ...migratePersistedState(persisted) }),
      partialize: (state) => ({
        stateSchemaVersion: state.stateSchemaVersion,
        protocolVersion: state.protocolVersion,
        localResetDone: state.localResetDone,
        localResetDoneScopes: state.localResetDoneScopes,
        docs: state.docs,
        replicas: state.replicas,
        queue: state.queue,
        conflicts: state.conflicts,
        cursor: state.cursor,
        cursors: state.cursors,
        checkpoints: state.checkpoints,
        lastSyncError: state.lastSyncError,
        lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
        lastSyncErrors: state.lastSyncErrors,
        lastSuccessfulSyncAts: state.lastSuccessfulSyncAts,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (state && !error) state.recoverInterruptedMutations({ allScopes: true });
        hydrationResult = { error: error || null };
        resolveHydration(hydrationResult);
      },
    },
  ),
);

export async function waitForSyncStoreHydration() {
  if (useSyncStore.persist.hasHydrated()) {
    if (hydrationResult?.error) throw hydrationResult.error;
    return;
  }
  const result = await hydrationPromise;
  if (result?.error) throw result.error;
}

export { migratePersistedState };
export default useSyncStore;
