/**
 * ???????
 *
 * ?????????????????????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 主题 store。
 *
 * 统一维护亮暗主题，并把结果同步到 `document.documentElement.dataset.theme`
 * 供全局样式立即生效。
 */
const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'light',
      themeUpdatedAt: 0,

      /**
       * 显式设置主题，同时记录可用于云同步比较的更新时间。
       */
      setTheme: (theme, meta = {}) => {
        document.documentElement.dataset.theme = theme;
        set({
          theme,
          themeUpdatedAt: meta.updatedAt ?? Date.now(),
        });
      },

      /**
       * 在亮色与暗色主题之间切换。
       */
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        set({
          theme: next,
          themeUpdatedAt: Date.now(),
        });
      },

      /**
       * 初始化主题。
       *
       * 优先读取持久化结果；若没有历史值，再回退到系统颜色方案偏好。
       */
      initTheme: () => {
        // 只有在没有本地持久化结果时才回退到系统主题偏好。
        const persisted = localStorage.getItem('mde-theme');
        const savedTheme = persisted ? JSON.parse(persisted)?.state?.theme : null;
        const initial = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = initial;
        set((state) => ({
          theme: initial,
          themeUpdatedAt: state.themeUpdatedAt || 0,
        }));
      },
    }),
    {
      name: 'mde-theme',
      // store 回填完成后立即把持久化主题应用到 DOM，避免首屏闪烁。
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.dataset.theme = state.theme;
        }
      },
    }
  )
);

export default useThemeStore;
