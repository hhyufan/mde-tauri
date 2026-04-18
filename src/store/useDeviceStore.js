import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Stable per-device identifier.
 *
 * Generated once, on first access, and persisted to localStorage. The cloud
 * sync layer sends this id with every push so the server can record where
 * each individual device keeps its on-disk copy of the document
 * (`SyncDocument.devicePaths[deviceId] = absoluteLocalPath`).
 *
 * Reinstalling the app / clearing storage produces a *new* device id, which
 * is intentional — the new install has no on-disk files and must rebind via
 * the "external first save" flow.
 */
function newDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `dev_${crypto.randomUUID()}`;
  }
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const useDeviceStore = create(
  persist(
    (set, get) => ({
      deviceId: '',

      /** Returns the current device id, minting + persisting one if missing. */
      getId: () => {
        const cur = get().deviceId;
        if (cur) return cur;
        const id = newDeviceId();
        set({ deviceId: id });
        return id;
      },
    }),
    {
      name: 'mde-device-id',
    },
  ),
);

export default useDeviceStore;
