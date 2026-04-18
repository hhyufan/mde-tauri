import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'light',

      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme;
        set({ theme });
      },

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        set({ theme: next });
      },

      initTheme: () => {
        // Only fall back to system preference if no persisted value exists
        const persisted = localStorage.getItem('mde-theme');
        const savedTheme = persisted ? JSON.parse(persisted)?.state?.theme : null;
        const initial = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = initial;
        set({ theme: initial });
      },
    }),
    {
      name: 'mde-theme',
      // Apply the persisted theme to the DOM as soon as the store rehydrates
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.dataset.theme = state.theme;
        }
      },
    }
  )
);

export default useThemeStore;
