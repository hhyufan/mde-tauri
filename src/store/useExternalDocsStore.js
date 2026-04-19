import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * In-memory cache of cloud documents that have been pulled to this device
 * but never bound to a local file path here (i.e. the server's
 * `devicePaths[myDeviceId]` is missing for this fileId).
 *
 * Such "external" documents appear in the sidebar via a virtual path of
 * the form `cloud://<fileId>`. Opening one creates an editor tab whose
 * content comes from this store, and on first save we trigger a `Save As`
 * dialog, save to disk, then push the chosen path back to the server so
 * the document becomes "bound" on this device for all subsequent syncs.
 *
 * The store is persisted so that an unbound external bookmark survives an
 * app restart — otherwise the user would lose the ability to claim it
 * without running another sync round.
 */
const useExternalDocsStore = create(
  persist(
    (set, get) => ({
      /** `{ [fileId]: { name, ext, encoding, lineEnding, originalPath, content, checksum } }` */
      docs: {},

      /**
       * Merge `patch` into the entry for `fileId` (creating it if absent).
       * Used both to seed display metadata from the manifest (`name`,
       * `ext`) and to fill in the body once a per-file pull succeeds.
       */
      put: (fileId, patch) => {
        if (!fileId) return;
        set((state) => ({
          docs: {
            ...state.docs,
            [fileId]: { ...(state.docs[fileId] || {}), ...patch },
          },
        }));
      },

      get: (fileId) => get().docs[fileId] || null,

      remove: (fileId) => {
        if (!fileId) return;
        set((state) => {
          const next = { ...state.docs };
          delete next[fileId];
          return { docs: next };
        });
      },

      /** Replace the full set (used when reconciling against the server). */
      replaceAll: (docs) => set({ docs: docs || {} }),

      ids: () => Object.keys(get().docs),

      reset: () => set({ docs: {} }),
    }),
    {
      name: 'mde-external-docs',
    },
  ),
);

export default useExternalDocsStore;
