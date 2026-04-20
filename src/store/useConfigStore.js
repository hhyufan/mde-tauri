import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useConfigStore = create(
  persist(
    (set) => ({
      language: 'en',
      fontSize: 14,
      fontFamily: 'JetBrains Mono',
      lineHeight: 24,
      tabSize: 2,
      wordWrap: true,
      lineNumbers: true,
      minimap: { enabled: false },
      autoSave: true,
      workspacePath: '',
      serverUrl: 'https://www.miaogu.xyz',
      syncEnabled: true,
      configUpdatedAt: 0,

      setConfig: (key, value, meta = {}) => set((state) => ({
        ...state,
        [key]: value,
        configUpdatedAt: meta.updatedAt ?? Date.now(),
      })),
      loadConfig: (config, meta = {}) => set((state) => ({
        ...state,
        ...config,
        configUpdatedAt: meta.updatedAt ?? state.configUpdatedAt ?? Date.now(),
      })),
    }),
    {
      name: 'mde-config',
    }
  )
);

export default useConfigStore;
