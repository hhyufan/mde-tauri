import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUserScopeId, isOwnedByUser } from './userScope';

function scopedDocKey(fileId) {
  return `${getCurrentUserScopeId()}::${fileId}`;
}

export function getScopedExternalDocsMap(docs, userId) {
  return Object.fromEntries(
    Object.entries(docs || {}).filter(([, doc]) => isOwnedByUser(doc?.ownerUserId, userId))
  );
}

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
        const key = scopedDocKey(fileId);
        set((state) => ({
          docs: {
            ...state.docs,
            [key]: {
              ...(state.docs[key] || {}),
              ...patch,
              fileId,
              ownerUserId: getCurrentUserScopeId(),
            },
          },
        }));
      },

      get: (fileId) => get().docs[scopedDocKey(fileId)] || null,

      remove: (fileId) => {
        if (!fileId) return;
        set((state) => {
          const next = { ...state.docs };
          delete next[scopedDocKey(fileId)];
          return { docs: next };
        });
      },

      /** Replace the current user's full set (used when reconciling against the server). */
      replaceAll: (docs) =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          const preserved = Object.fromEntries(
            Object.entries(state.docs).filter(([, doc]) => !isOwnedByUser(doc?.ownerUserId, ownerUserId))
          );
          const nextDocs = Object.fromEntries(
            Object.entries(docs || {}).map(([fileId, doc]) => [
              `${ownerUserId}::${fileId}`,
              { ...doc, fileId, ownerUserId },
            ])
          );
          return { docs: { ...preserved, ...nextDocs } };
        }),

      ids: () =>
        Object.values(get().docs)
          .filter((doc) => isOwnedByUser(doc?.ownerUserId, getCurrentUserScopeId()))
          .map((doc) => doc.fileId)
          .filter(Boolean),

      resetCurrentUser: () =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          return {
            docs: Object.fromEntries(
              Object.entries(state.docs).filter(([, doc]) => !isOwnedByUser(doc?.ownerUserId, ownerUserId))
            ),
          };
        }),

      reset: () => set({ docs: {} }),
    }),
    {
      name: 'mde-external-docs',
    },
  ),
);

export default useExternalDocsStore;
