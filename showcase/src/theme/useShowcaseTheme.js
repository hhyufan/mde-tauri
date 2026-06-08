import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function resolveInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

const useShowcaseTheme = create(
  persist(
    (set, get) => ({
      theme: 'light',
      initTheme: () => {
        const theme = get().theme || resolveInitialTheme();
        applyTheme(theme);
        set({ theme });
      },
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        set({ theme: nextTheme });
      },
    }),
    {
      name: 'mde-showcase-theme',
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyTheme(state.theme);
        }
      },
    }
  )
);

export default useShowcaseTheme;
