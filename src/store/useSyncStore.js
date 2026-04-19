import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SYNC_PROTOCOL_VERSION = 2;

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
      docs: {},
      queue: [],
      conflicts: [],
      cursor: '',
      lastSyncError: null,

      markLocalResetDone: () => set({ localResetDone: true }),

      clearAllSyncState: () =>
        set({
          protocolVersion: SYNC_PROTOCOL_VERSION,
          localResetDone: false,
          docs: {},
          queue: [],
          conflicts: [],
          cursor: '',
          lastSyncError: null,
        }),

      resetDocumentsAndQueue: () =>
        set({
          docs: {},
          queue: [],
          conflicts: [],
          cursor: '',
          lastSyncError: null,
        }),

      setCursor: (cursor) => set({ cursor: cursor || '' }),
      setLastSyncError: (error) => set({ lastSyncError: error || null }),

      getDoc: (fileId) => get().docs[fileId] || null,

      findDocByPath: (localPath) => {
        if (!localPath) return null;
        return Object.values(get().docs).find((doc) => doc.localPath === localPath) || null;
      },

      listDocs: () => Object.values(get().docs),

      upsertDoc: (fileId, patch) => {
        if (!fileId) return;
        set((state) => ({
          docs: {
            ...state.docs,
            [fileId]: {
              ...(state.docs[fileId] || {
                fileId,
                rev: 0,
                lastKnownServerRev: 0,
                deleted: false,
                status: 'idle',
              }),
              ...patch,
            },
          },
        }));
      },

      removeDoc: (fileId) => {
        if (!fileId) return;
        set((state) => {
          const nextDocs = { ...state.docs };
          delete nextDocs[fileId];
          return { docs: nextDocs };
        });
      },

      bindLocalPath: (fileId, localPath, patch = {}) => {
        if (!fileId || !localPath) return;
        set((state) => ({
          docs: {
            ...state.docs,
            [fileId]: {
              ...(state.docs[fileId] || {
                fileId,
                rev: 0,
                lastKnownServerRev: 0,
                deleted: false,
              }),
              ...patch,
              localPath,
              deleted: false,
            },
          },
        }));
      },

      moveLocalPath: (oldPath, newPath, patch = {}) => {
        if (!oldPath || !newPath || oldPath === newPath) return;
        const fileId = Object.values(get().docs).find((doc) => doc.localPath === oldPath)?.fileId;
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
            Object.entries(state.docs).filter(([, doc]) => !(doc.deleted && !doc.localPath)),
          );
          return { docs: nextDocs };
        });
      },

      hasPendingMutation: (fileId) =>
        get().queue.some(
          (item) =>
            item.fileId === fileId && ['pending', 'processing'].includes(item.status),
        ),

      enqueueMutation: ({ fileId, type, payload, baseRev = 0, mutationId, dedupeKey }) => {
        if (!fileId || !type) return null;
        const id = mutationId || newMutationId();
        set((state) => {
          let nextQueue = [...state.queue];

          if (type === 'delete') {
            nextQueue = nextQueue.filter((item) => item.fileId !== fileId);
          } else if (dedupeKey) {
            nextQueue = nextQueue.filter(
              (item) => !(item.fileId === fileId && item.dedupeKey === dedupeKey),
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
          });
          return { queue: nextQueue };
        });
        return id;
      },

      getReadyMutation: () => {
        const now = Date.now();
        return get().queue
          .filter((item) => item.status === 'pending' && item.nextRetryAt <= now)
          .sort((a, b) => a.nextRetryAt - b.nextRetryAt)[0] || null;
      },

      getNextRetryAt: () => {
        const times = get().queue
          .filter((item) => item.status === 'pending')
          .map((item) => item.nextRetryAt);
        if (times.length === 0) return null;
        return Math.min(...times);
      },

      markMutationProcessing: (mutationId) =>
        set((state) => ({
          queue: state.queue.map((item) =>
            item.mutationId === mutationId ? { ...item, status: 'processing' } : item
          ),
        })),

      completeMutation: (mutationId) =>
        set((state) => ({
          queue: state.queue.filter((item) => item.mutationId !== mutationId),
        })),

      failMutation: (mutationId, lastError) =>
        set((state) => ({
          queue: state.queue.map((item) => {
            if (item.mutationId !== mutationId) return item;
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
          queue: state.queue.filter((item) => item.fileId !== fileId),
        })),

      addConflict: (conflict) => {
        if (!conflict?.fileId) return;
        set((state) => {
          const existing = state.conflicts.filter((item) => item.fileId !== conflict.fileId);
          return { conflicts: [...existing, conflict] };
        });
      },

      resolveConflict: (fileId) =>
        set((state) => ({
          conflicts: state.conflicts.filter((item) => item.fileId !== fileId),
        })),
    }),
    {
      name: 'mde-sync-state',
      version: SYNC_PROTOCOL_VERSION,
      partialize: (state) => ({
        protocolVersion: state.protocolVersion,
        localResetDone: state.localResetDone,
        docs: state.docs,
        queue: state.queue,
        conflicts: state.conflicts,
        cursor: state.cursor,
      }),
    },
  ),
);

export default useSyncStore;
