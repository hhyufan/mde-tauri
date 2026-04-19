import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

      setFiles: (files) => set({ files }),

      addRecentFile: (file) =>
        set((state) => {
          const filtered = state.recentFiles.filter((f) => f.path !== file.path);
          return { recentFiles: [file, ...filtered].slice(0, 20) };
        }),

      clearRecentFiles: () => set({ recentFiles: [] }),

      removeRecentFile: (path) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter((f) => f.path !== path),
        })),

      replaceRecentFilePath: (oldPath, newPath, name = '') =>
        set((state) => ({
          recentFiles: state.recentFiles.map((f) =>
            f.path === oldPath
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
          const exists = state.bookmarkedPaths.includes(path);
          return {
            bookmarkedPaths: exists
              ? state.bookmarkedPaths.filter((p) => p !== path)
              : [...state.bookmarkedPaths, path],
          };
        }),

      isBookmarked: (path) => {
        return useFileStore.getState().bookmarkedPaths.includes(path);
      },

      replaceBookmarkPath: (oldPath, newPath) =>
        set((state) => ({
          bookmarkedPaths: state.bookmarkedPaths.map((p) =>
            p === oldPath ? newPath : p
          ),
        })),

      removeCloudBookmarks: () =>
        set((state) => ({
          bookmarkedPaths: state.bookmarkedPaths.filter(
            (p) => typeof p !== 'string' || !p.startsWith('cloud://'),
          ),
        })),

      resetSyncUiState: () =>
        set((state) => ({
          bookmarkedPaths: state.bookmarkedPaths.filter(
            (p) => typeof p !== 'string' || !p.startsWith('cloud://'),
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
