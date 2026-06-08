/**
 * ?????????
 *
 * ??????????????????????????????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getCurrentUserScopeId,
  isOwnedByUser,
  normalizeOwnerUserId,
} from './userScope';

/**
 * 文件浏览与近期记录 store。
 *
 * 管理当前目录、目录历史、最近文件、书签和排序配置；其中最近文件与书签
 * 都按用户作用域隔离，避免账号切换时互相污染。
 */
/**
 * ????????????????????????????
 */
function bookmarkPathOf(entry) {
  return typeof entry === 'string' ? entry : entry?.path || '';
}

/**
 * 提取当前用户可见的书签路径列表，兼容旧版纯字符串结构与新版对象结构。
 */
export function getScopedBookmarkedPaths(bookmarkedPaths, userId) {
  return (bookmarkedPaths || [])
    .filter((entry) =>
      isOwnedByUser(typeof entry === 'string' ? null : entry?.ownerUserId, userId)
    )
    .map((entry) => bookmarkPathOf(entry))
    .filter(Boolean);
}

/**
 * ???????????????????
 */
export function getScopedRecentFiles(recentFiles, userId) {
  return (recentFiles || []).filter((entry) =>
    isOwnedByUser(entry?.ownerUserId, userId)
  );
}

/**
 * 文件面板数据 store。
 *
 * 保存当前目录、目录历史、最近文件、书签以及排序方式，并对需要持久化的
 * 用户数据按账号作用域隔离。
 */
const useFileStore = create(
  persist(
    (set) => ({
      currentDir: '',
      dirHistory: [],
      historyIndex: -1,
      files: [],
      recentFiles: [],
      bookmarkedPaths: [],
      sortBy: 'name',
      sortOrder: 'asc',

      // `setCurrentDir` 会推进目录浏览历史；若只是刷新同一路径的文件列表，应
      // 交给 `useFileManager.loadFilesOnly()`，避免回退栈被重复目录污染。
      setCurrentDir: (dir) =>
        set((state) => {
          const newHistory = [...state.dirHistory.slice(0, state.historyIndex + 1), dir];
          return {
            currentDir: dir,
            dirHistory: newHistory,
            historyIndex: newHistory.length - 1,
          };
        }),

      /** ????????????? */
      goBack: () =>
        set((state) => {
          if (state.historyIndex <= 0) return state;
          const newIndex = state.historyIndex - 1;
          return {
            historyIndex: newIndex,
            currentDir: state.dirHistory[newIndex],
          };
        }),

      goForward: () =>
        set((state) => {
          if (state.historyIndex >= state.dirHistory.length - 1) return state;
          const newIndex = state.historyIndex + 1;
          return {
            historyIndex: newIndex,
            currentDir: state.dirHistory[newIndex],
          };
        }),

      // 只窥视回退/前进目标路径，不直接修改当前状态。
      peekBack: (state) =>
        state.historyIndex > 0
          ? state.dirHistory[state.historyIndex - 1]
          : null,

      peekForward: (state) =>
        state.historyIndex < state.dirHistory.length - 1
          ? state.dirHistory[state.historyIndex + 1]
          : null,

      /** ?????????????? */
      clearDirectory: () =>
        set({
          currentDir: '',
          files: [],
          dirHistory: [],
          historyIndex: -1,
        }),

      /** ?????????????????? */
      setFiles: (files) => set({ files }),

      /**
       * 追加最近文件时，只重排当前用户自己的列表，其他账号数据保持原样。
       */
      addRecentFile: (file) =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          const nextFile = { ...file, ownerUserId };
          const keptOtherUsers = state.recentFiles.filter(
            (f) => !isOwnedByUser(f?.ownerUserId, ownerUserId)
          );
          const currentUserFiles = getScopedRecentFiles(state.recentFiles, ownerUserId)
            .filter((f) => f.path !== file.path);
          return {
            recentFiles: [...keptOtherUsers, nextFile, ...currentUserFiles].slice(0, keptOtherUsers.length + 20),
          };
        }),

      /**
       * 清空当前用户作用域下的最近文件，不影响其他账号的持久化记录。
       */
      clearRecentFiles: () =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          return {
            recentFiles: state.recentFiles.filter(
              (f) => !isOwnedByUser(f?.ownerUserId, ownerUserId)
            ),
          };
        }),

      /** ???????????????????? */
      removeRecentFile: (path) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter((f) => {
            if (!isOwnedByUser(f?.ownerUserId, getCurrentUserScopeId())) return true;
            return f.path !== path;
          }),
        })),

      /** ????????????????????? */
      replaceRecentFilePath: (oldPath, newPath, name = '') =>
        set((state) => ({
          recentFiles: state.recentFiles.map((f) =>
            isOwnedByUser(f?.ownerUserId, getCurrentUserScopeId()) && f.path === oldPath
              ? {
                  ...f,
                  path: newPath,
                  name: name || f.name,
                  ext: (name || f.name || '').split('.').pop() || f.ext,
                }
              : f
          ),
        })),

      /** ????????????????? */
      toggleBookmark: (path) =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          const currentUserPaths = getScopedBookmarkedPaths(state.bookmarkedPaths, ownerUserId);
          const exists = currentUserPaths.includes(path);
          return {
            bookmarkedPaths: exists
              ? state.bookmarkedPaths.filter((entry) => !(
                isOwnedByUser(
                  typeof entry === 'string' ? null : entry?.ownerUserId,
                  ownerUserId,
                ) && bookmarkPathOf(entry) === path
              ))
              : [...state.bookmarkedPaths, { path, ownerUserId }],
          };
        }),

      /** ?????????????????????? */
      isBookmarked: (path) => {
        return getScopedBookmarkedPaths(
          useFileStore.getState().bookmarkedPaths,
          getCurrentUserScopeId(),
        ).includes(path);
      },

      /**
       * 文件被移动或重命名后，同步修正当前用户作用域里的书签路径。
       */
      replaceBookmarkPath: (oldPath, newPath) =>
        set((state) => ({
          bookmarkedPaths: state.bookmarkedPaths.map((entry) =>
            isOwnedByUser(
              typeof entry === 'string' ? null : entry?.ownerUserId,
              getCurrentUserScopeId(),
            ) && bookmarkPathOf(entry) === oldPath
              ? { path: newPath, ownerUserId: normalizeOwnerUserId(
                typeof entry === 'string' ? null : entry?.ownerUserId
              ) }
              : entry
          ),
        })),

      /**
       * 云端书签只对当前用户作用域做清理，避免误删其他账号的持久数据。
       */
      removeCloudBookmarks: () =>
        set((state) => ({
          bookmarkedPaths: state.bookmarkedPaths.filter(
            (entry) => !(
              isOwnedByUser(
                typeof entry === 'string' ? null : entry?.ownerUserId,
                getCurrentUserScopeId(),
              ) && bookmarkPathOf(entry).startsWith('cloud://')
            ),
          ),
        })),

      /** ?????????????? UI ??? */
      resetSyncUiState: () =>
        set((state) => ({
          bookmarkedPaths: state.bookmarkedPaths.filter(
            (entry) => !(
              isOwnedByUser(
                typeof entry === 'string' ? null : entry?.ownerUserId,
                getCurrentUserScopeId(),
              ) && bookmarkPathOf(entry).startsWith('cloud://')
            ),
          ),
        })),

      /** ??????????? */
      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (order) => set({ sortOrder: order }),
    }),
    {
      name: 'mde-files',
      // 不持久化运行时目录内容和导航栈，只保留需要跨重启延续的用户数据。
      partialize: (state) => ({
        recentFiles: state.recentFiles,
        bookmarkedPaths: state.bookmarkedPaths,
        currentDir: state.currentDir,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
      }),
    }
  )
);

export default useFileStore;
