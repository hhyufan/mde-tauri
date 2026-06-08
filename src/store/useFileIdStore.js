
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUserScopeId } from './userScope';

/**
 * 为路径键补上当前用户作用域，避免不同账号的本地映射互相覆盖。
 */
function scopePathKey(path) {
  return `${getCurrentUserScopeId()}::path::${path}`;
}

/**
 * 为 fileId 键补上当前用户作用域。
 */
function scopeFileIdKey(fileId) {
  return `${getCurrentUserScopeId()}::file::${fileId}`;
}

/**
 * 本地路径与云端 `fileId` 的稳定映射 store。
 *
 * 云同步层不直接以绝对路径标识文档，而是依赖 `fileId` 维持“同一逻辑文件”
 * 在多设备上的身份一致性。这里负责在设备本地生成、持久化并维护这份映射。
 *
 * 如果两台设备在完全没有同步历史的前提下独立创建“看起来相同”的文件，
 * 它们会得到不同的 `fileId`，从而形成两份独立云文档。这是刻意设计的保守
 * 策略，避免系统在缺乏可靠依据时误把不同文件自动合并。
 */
const useFileIdStore = create(
  persist(
    (set, get) => ({
      pathToId: {},
      idToPath: {},

      /**
       * 读取路径已有的 `fileId`，若不存在则创建并持久化一个新值。
       */
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

      /**
       * 显式把路径绑定到已有 `fileId`，常用于远端拉取后回填本地映射。
       */
      bind: (path, fileId) => {
        if (!path || !fileId) return;
        set((state) => ({
          pathToId: { ...state.pathToId, [scopePathKey(path)]: fileId },
          idToPath: { ...state.idToPath, [scopeFileIdKey(fileId)]: path },
        }));
      },

      /**
       * 在文件移动或重命名后迁移路径绑定，同时保持逻辑文档身份不变。
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

      /**
       * 常用双向查询辅助方法。
       */
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

      /**
       * 清空当前用户作用域下的全部映射，常用于账号切换后的同步重置。
       */
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
