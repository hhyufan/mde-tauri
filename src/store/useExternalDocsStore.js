/**
 * ??????????
 *
 * ???????????????????????? `cloud://` ????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUserScopeId, isOwnedByUser } from './userScope';

/**
 * ?????????????????
 */
function scopedDocKey(fileId) {
  return `${getCurrentUserScopeId()}::${fileId}`;
}

export function getScopedExternalDocsMap(docs, userId) {
  return Object.fromEntries(
    Object.entries(docs || {}).filter(([, doc]) => isOwnedByUser(doc?.ownerUserId, userId))
  );
}

/**
 * 缓存那些已经同步到当前设备、但尚未在本机绑定实际文件路径的云端文档。
 * 也就是服务端记录里，这个 `fileId` 还没有对应的
 * `devicePaths[myDeviceId]`。
 *
 * 这类“外部文档”会以 `cloud://<fileId>` 这种虚拟路径出现在侧边栏。
 * 打开后，编辑器标签页读取的正文内容来自本 store；当用户第一次保存时，
 * 会触发一次“另存为”，把内容落盘，并将新选择的本地路径回写到服务端。
 * 这样后续同步时，这份文档就会被视为当前设备已绑定文件。
 *
 * 之所以要持久化这个 store，是为了让尚未绑定的外部书签在应用重启后仍然存在；
 * 否则用户必须再跑一轮同步，才能重新“认领”这份文档。
 */
const useExternalDocsStore = create(
  persist(
    (set, get) => ({
      /** 外部文档表：`{ [fileId]: { name, ext, encoding, lineEnding, originalPath, content, checksum } }` */
      docs: {},

      /**
       * 将 `patch` 合并到指定 `fileId` 的条目中；若条目不存在则先创建。
       * 既用于从清单中写入展示元数据（如 `name`、`ext`），
       * 也用于在单文件拉取成功后补齐正文与其他同步字段。
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

      /** ???? `fileId` ???????? */
      get: (fileId) => get().docs[scopedDocKey(fileId)] || null,

      /** ?????????????? */
      remove: (fileId) => {
        if (!fileId) return;
        set((state) => {
          const next = { ...state.docs };
          delete next[scopedDocKey(fileId)];
          return { docs: next };
        });
      },

      /** 用服务端最新结果整体替换当前用户的外部文档集合，主要用于同步对账。 */
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

      /** ???????????????? `fileId` ??? */
      ids: () =>
        Object.values(get().docs)
          .filter((doc) => isOwnedByUser(doc?.ownerUserId, getCurrentUserScopeId()))
          .map((doc) => doc.fileId)
          .filter(Boolean),

      /** ??????????????????????? */
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
