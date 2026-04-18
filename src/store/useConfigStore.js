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

      setConfig: (key, value) => {
        if (key === 'serverUrl') return;
        set({ [key]: value });
      },
      loadConfig: (config) => set(config),
    }),
    {
      name: 'mde-config',
    }
  )
);

export default useConfigStore;
