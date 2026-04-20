import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUserScopeId } from './userScope';

function scopePathKey(path) {
  return `${getCurrentUserScopeId()}::path::${path}`;
}

function scopeFileIdKey(fileId) {
  return `${getCurrentUserScopeId()}::file::${fileId}`;
}

/**
 * Stable mapping `originalPath -> fileId (UUID)`.
 *
 * The cloud sync layer addresses every file by `fileId` instead of by path
 * so that the same logical document can be pushed/pulled across devices
 * whose absolute paths differ. The first time a path is seen we mint a new
 * UUID and remember it forever (per device, persisted to local storage).
 *
 * If two devices independently create the same file (same path, no prior
 * sync) they will end up with two different fileIds and therefore two
 * separate cloud documents. That is intentional — the system has no
 * reliable way to merge such files automatically; users can resolve
 * conflicts manually if/when needed.
 */
const useFileIdStore = create(
  persist(
    (set, get) => ({
      pathToId: {},
      idToPath: {},

      /** Returns the existing UUID for a path, or mints + persists a new one. */
      getOrCreate: (path) => {
        if (!path) return null;
        const { pathToId } = get();
        const scopedPath = scopePathKey(path);
        if (pathToId[scopedPath]) return pathToId[scopedPath];
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        set((state) => ({
          pathToId: { ...state.pathToId, [scopedPath]: id },
          idToPath: { ...state.idToPath, [scopeFileIdKey(id)]: path },
        }));
        return id;
      },

      /** Explicitly bind a path to an existing fileId (used after pull). */
      bind: (path, fileId) => {
        if (!path || !fileId) return;
        set((state) => ({
          pathToId: { ...state.pathToId, [scopePathKey(path)]: fileId },
          idToPath: { ...state.idToPath, [scopeFileIdKey(fileId)]: path },
        }));
      },

      /**
       * Move an existing path binding to a new local path while preserving
       * the logical document identity (`fileId`).
       */
      movePath: (oldPath, newPath) => {
        if (!oldPath || !newPath || oldPath === newPath) return;
        const oldScopedPath = scopePathKey(oldPath);
        const fileId = get().pathToId[oldScopedPath];
        if (!fileId) return;
        set((state) => {
          const nextPathToId = { ...state.pathToId };
          const nextIdToPath = { ...state.idToPath, [scopeFileIdKey(fileId)]: newPath };
          delete nextPathToId[oldScopedPath];
          nextPathToId[scopePathKey(newPath)] = fileId;
          return {
            pathToId: nextPathToId,
            idToPath: nextIdToPath,
          };
        });
      },

      /** Lookup helpers. */
      idOf: (path) => get().pathToId[scopePathKey(path)] || null,
      pathOf: (fileId) => get().idToPath[scopeFileIdKey(fileId)] || null,

      forget: (path) => {
        const scopedPath = scopePathKey(path);
        const id = get().pathToId[scopedPath];
        if (!id) return;
        set((state) => {
          const np = { ...state.pathToId };
          const ni = { ...state.idToPath };
          delete np[scopedPath];
          delete ni[scopeFileIdKey(id)];
          return { pathToId: np, idToPath: ni };
        });
      },

      unbindFileId: (fileId) => {
        if (!fileId) return;
        const scopedFileId = scopeFileIdKey(fileId);
        const path = get().idToPath[scopedFileId];
        if (!path) return;
        set((state) => {
          const np = { ...state.pathToId };
          const ni = { ...state.idToPath };
          delete np[scopePathKey(path)];
          delete ni[scopedFileId];
          return { pathToId: np, idToPath: ni };
        });
      },

      resetCurrentUser: () =>
        set((state) => {
          const scopePrefix = `${getCurrentUserScopeId()}::`;
          return {
            pathToId: Object.fromEntries(
              Object.entries(state.pathToId).filter(([key]) => !key.startsWith(scopePrefix))
            ),
            idToPath: Object.fromEntries(
              Object.entries(state.idToPath).filter(([key]) => !key.startsWith(scopePrefix))
            ),
          };
        }),

      reset: () => set({ pathToId: {}, idToPath: {} }),
    }),
    {
      name: 'mde-file-ids',
    },
  ),
);

export default useFileIdStore;
