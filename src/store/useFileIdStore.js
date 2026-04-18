import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
        if (pathToId[path]) return pathToId[path];
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        set((state) => ({
          pathToId: { ...state.pathToId, [path]: id },
          idToPath: { ...state.idToPath, [id]: path },
        }));
        return id;
      },

      /** Explicitly bind a path to an existing fileId (used after pull). */
      bind: (path, fileId) => {
        if (!path || !fileId) return;
        set((state) => ({
          pathToId: { ...state.pathToId, [path]: fileId },
          idToPath: { ...state.idToPath, [fileId]: path },
        }));
      },

      /** Lookup helpers. */
      idOf: (path) => get().pathToId[path] || null,
      pathOf: (fileId) => get().idToPath[fileId] || null,

      forget: (path) => {
        const id = get().pathToId[path];
        if (!id) return;
        set((state) => {
          const np = { ...state.pathToId };
          const ni = { ...state.idToPath };
          delete np[path];
          delete ni[id];
          return { pathToId: np, idToPath: ni };
        });
      },
    }),
    {
      name: 'mde-file-ids',
    },
  ),
);

export default useFileIdStore;
