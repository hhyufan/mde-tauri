import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getCurrentUserScopeId,
  isOwnedByUser,
  normalizeOwnerUserId,
} from './userScope';

function bookmarkPathOf(entry) {
  return typeof entry === 'string' ? entry : entry?.path || '';
}

export function getScopedBookmarkedPaths(bookmarkedPaths, userId) {
  return (bookmarkedPaths || [])
    .filter((entry) =>
      isOwnedByUser(typeof entry === 'string' ? null : entry?.ownerUserId, userId)
    )
    .map((entry) => bookmarkPathOf(entry))
    .filter(Boolean);
}

export function getScopedRecentFiles(recentFiles, userId) {
  return (recentFiles || []).filter((entry) =>
    isOwnedByUser(entry?.ownerUserId, userId)
  );
}

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

      setCurrentDir: (dir) =>
        set((state) => {
          const newHistory = [...state.dirHistory.slice(0, state.historyIndex + 1), dir];
          return {
            currentDir: dir,
            dirHistory: newHistory,
            historyIndex: newHistory.length - 1,
          };
        }),

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

      // Return the target path of back/forward without mutating state
      peekBack: (state) =>
        state.historyIndex > 0
          ? state.dirHistory[state.historyIndex - 1]
          : null,

      peekForward: (state) =>
        state.historyIndex < state.dirHistory.length - 1
          ? state.dirHistory[state.historyIndex + 1]
          : null,

      clearDirectory: () =>
        set({
          currentDir: '',
          files: [],
          dirHistory: [],
          historyIndex: -1,
        }),

      setFiles: (files) => set({ files }),

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

      clearRecentFiles: () =>
        set((state) => {
          const ownerUserId = getCurrentUserScopeId();
          return {
            recentFiles: state.recentFiles.filter(
              (f) => !isOwnedByUser(f?.ownerUserId, ownerUserId)
            ),
          };
        }),

      removeRecentFile: (path) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter((f) => {
            if (!isOwnedByUser(f?.ownerUserId, getCurrentUserScopeId())) return true;
            return f.path !== path;
          }),
        })),

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

      isBookmarked: (path) => {
        return getScopedBookmarkedPaths(
          useFileStore.getState().bookmarkedPaths,
          getCurrentUserScopeId(),
        ).includes(path);
      },

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

      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (order) => set({ sortOrder: order }),
    }),
    {
      name: 'mde-files',
      // Don't persist the in-memory file list or navigation history —
      // only persist user data that should survive restarts
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
