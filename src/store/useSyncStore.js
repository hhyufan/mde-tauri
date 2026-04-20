import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUserScopeId, isOwnedByUser } from './userScope';

export const SYNC_PROTOCOL_VERSION = 2;

function scopedDocKey(fileId) {
  return `${getCurrentUserScopeId()}::${fileId}`;
}

function listOwnedDocs(docs) {
  return Object.values(docs || {}).filter((doc) =>
    isOwnedByUser(doc?.ownerUserId, getCurrentUserScopeId())
  );
}

function listOwnedQueue(queue) {
  return (queue || []).filter((item) =>
    isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
  );
}

function listOwnedConflicts(conflicts) {
  return (conflicts || []).filter((item) =>
    isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
  );
}

function newMutationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function nextRetryAt(retryCount) {
  const delayMs = Math.min(60_000, 2000 * (2 ** Math.max(0, retryCount - 1)));
  return Date.now() + delayMs;
}

const useSyncStore = create(
  persist(
    (set, get) => ({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      localResetDone: false,
      localResetDoneScopes: {},
      docs: {},
      queue: [],
      conflicts: [],
      cursor: '',
      cursors: {},
      lastSyncError: null,

      markLocalResetDone: () =>
        set((state) => ({
          localResetDone: true,
          localResetDoneScopes: {
            ...(state.localResetDoneScopes || {}),
            [getCurrentUserScopeId()]: true,
          },
        })),
      isLocalResetDone: () => !!get().localResetDoneScopes?.[getCurrentUserScopeId()],

      clearAllSyncState: () =>
        set({
          protocolVersion: SYNC_PROTOCOL_VERSION,
          localResetDone: false,
          localResetDoneScopes: {},
          docs: {},
          queue: [],
          conflicts: [],
          cursor: '',
          cursors: {},
          lastSyncError: null,
        }),

      resetDocumentsAndQueue: () =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          return {
            docs: Object.fromEntries(
              Object.entries(state.docs).filter(([, doc]) => !isOwnedByUser(doc?.ownerUserId, ownerUserId))
            ),
            queue: state.queue.filter((item) => !isOwnedByUser(item?.ownerUserId, ownerUserId)),
            conflicts: state.conflicts.filter((item) => !isOwnedByUser(item?.ownerUserId, ownerUserId)),
            cursor: '',
            cursors: Object.fromEntries(
              Object.entries(state.cursors || {}).filter(([key]) => key !== ownerUserId)
            ),
            lastSyncError: null,
          };
        }),

      setCursor: (cursor) =>
        set((state) => ({
          cursor: cursor || '',
          cursors: {
            ...(state.cursors || {}),
            [getCurrentUserScopeId()]: cursor || '',
          },
        })),
      getCursor: () => {
        const ownerUserId = getCurrentUserScopeId();
        return get().cursors?.[ownerUserId] || (ownerUserId === 'guest' ? get().cursor || '' : '');
      },
      setLastSyncError: (error) => set({ lastSyncError: error || null }),

      getDoc: (fileId) => get().docs[scopedDocKey(fileId)] || null,

      findDocByPath: (localPath) => {
        if (!localPath) return null;
        return listOwnedDocs(get().docs).find((doc) => doc.localPath === localPath) || null;
      },

      listDocs: () => listOwnedDocs(get().docs),

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
                deleted: false,
                status: 'idle',
                ownerUserId: getCurrentUserScopeId(),
              }),
              ...patch,
              fileId,
              ownerUserId: getCurrentUserScopeId(),
            },
          },
        }));
      },

      removeDoc: (fileId) => {
        if (!fileId) return;
        set((state) => {
          const nextDocs = { ...state.docs };
          delete nextDocs[scopedDocKey(fileId)];
          return { docs: nextDocs };
        });
      },

      bindLocalPath: (fileId, localPath, patch = {}) => {
        if (!fileId || !localPath) return;
        const key = scopedDocKey(fileId);
        set((state) => ({
          docs: {
            ...state.docs,
            [key]: {
              ...(state.docs[key] || {
                fileId,
                rev: 0,
                lastKnownServerRev: 0,
                deleted: false,
                ownerUserId: getCurrentUserScopeId(),
              }),
              ...patch,
              localPath,
              deleted: false,
              fileId,
              ownerUserId: getCurrentUserScopeId(),
            },
          },
        }));
      },

      moveLocalPath: (oldPath, newPath, patch = {}) => {
        if (!oldPath || !newPath || oldPath === newPath) return;
        const fileId = listOwnedDocs(get().docs).find((doc) => doc.localPath === oldPath)?.fileId;
        if (!fileId) return;
        get().bindLocalPath(fileId, newPath, patch);
      },

      markDeleted: (fileId, patch = {}) => {
        if (!fileId) return;
        get().upsertDoc(fileId, {
          ...patch,
          deleted: true,
          status: patch.status || 'deleted',
        });
      },

      clearDeletedWithoutPath: () => {
        set((state) => {
          const nextDocs = Object.fromEntries(
            Object.entries(state.docs).filter(([, doc]) => {
              if (!isOwnedByUser(doc?.ownerUserId, getCurrentUserScopeId())) return true;
              return !(doc.deleted && !doc.localPath);
            }),
          );
          return { docs: nextDocs };
        });
      },

      hasPendingMutation: (fileId) =>
        listOwnedQueue(get().queue).some(
          (item) =>
            item.fileId === fileId && ['pending', 'processing'].includes(item.status),
        ),

      enqueueMutation: ({ fileId, type, payload, baseRev = 0, mutationId, dedupeKey }) => {
        if (!fileId || !type) return null;
        const id = mutationId || newMutationId();
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          let nextQueue = [...state.queue];

          if (type === 'delete') {
            nextQueue = nextQueue.filter(
              (item) => !(isOwnedByUser(item?.ownerUserId, ownerUserId) && item.fileId === fileId)
            );
          } else if (dedupeKey) {
            nextQueue = nextQueue.filter(
              (item) => !(
                isOwnedByUser(item?.ownerUserId, ownerUserId)
                && item.fileId === fileId
                && item.dedupeKey === dedupeKey
              ),
            );
          }

          nextQueue.push({
            id,
            mutationId: id,
            fileId,
            type,
            payload,
            baseRev,
            retryCount: 0,
            nextRetryAt: Date.now(),
            status: 'pending',
            dedupeKey: dedupeKey || type,
            ownerUserId,
          });
          return { queue: nextQueue };
        });
        return id;
      },

      getReadyMutation: () => {
        const now = Date.now();
        return listOwnedQueue(get().queue)
          .filter((item) => item.status === 'pending' && item.nextRetryAt <= now)
          .sort((a, b) => a.nextRetryAt - b.nextRetryAt)[0] || null;
      },

      getNextRetryAt: () => {
        const times = listOwnedQueue(get().queue)
          .filter((item) => item.status === 'pending')
          .map((item) => item.nextRetryAt);
        if (times.length === 0) return null;
        return Math.min(...times);
      },

      markMutationProcessing: (mutationId) =>
        set((state) => ({
          queue: state.queue.map((item) =>
            item.mutationId === mutationId
              && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
              ? { ...item, status: 'processing' }
              : item
          ),
        })),

      completeMutation: (mutationId) =>
        set((state) => ({
          queue: state.queue.filter((item) => !(
            item.mutationId === mutationId
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
          )),
        })),

      failMutation: (mutationId, lastError) =>
        set((state) => ({
          queue: state.queue.map((item) => {
            if (
              item.mutationId !== mutationId
              || !isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
            ) {
              return item;
            }
            const retryCount = item.retryCount + 1;
            return {
              ...item,
              status: 'pending',
              retryCount,
              nextRetryAt: nextRetryAt(retryCount),
              lastError: lastError || null,
            };
          }),
        })),

      dropMutationsForFile: (fileId) =>
        set((state) => ({
          queue: state.queue.filter((item) => !(
            item.fileId === fileId
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
          )),
        })),

      addConflict: (conflict) => {
        if (!conflict?.fileId) return;
        const ownerUserId = getCurrentUserScopeId();
        set((state) => {
          const existing = state.conflicts.filter((item) => !(
            item.fileId === conflict.fileId
            && isOwnedByUser(item?.ownerUserId, ownerUserId)
          ));
          return { conflicts: [...existing, { ...conflict, ownerUserId }] };
        });
      },

      listConflicts: () => listOwnedConflicts(get().conflicts),
      listQueue: () => listOwnedQueue(get().queue),

      resolveConflict: (fileId) =>
        set((state) => ({
          conflicts: state.conflicts.filter((item) => !(
            item.fileId === fileId
            && isOwnedByUser(item?.ownerUserId, getCurrentUserScopeId())
          )),
        })),
    }),
    {
      name: 'mde-sync-state',
      version: SYNC_PROTOCOL_VERSION,
      partialize: (state) => ({
        protocolVersion: state.protocolVersion,
        localResetDone: state.localResetDone,
        localResetDoneScopes: state.localResetDoneScopes,
        docs: state.docs,
        queue: state.queue,
        conflicts: state.conflicts,
        cursor: state.cursor,
        cursors: state.cursors,
      }),
    },
  ),
);

export default useSyncStore;
