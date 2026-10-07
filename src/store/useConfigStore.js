/**
 * ?????????
 *
 * ????????????????????????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { readInitialLanguage } from '@/i18n/language';

const DEVICE_LOCAL_CONFIG_KEYS = new Set([
  'workspacePath', 'serverUrl', 'syncEnabled',
  'backgroundImage', 'backgroundImageName', 'backgroundEnabled', 'backgroundTransparency',
]);
const initialLanguage = readInitialLanguage();

/**
 * 编辑器与预览配置 store。
 *
 * 聚合字体、行高、语言、自动保存、服务端地址等偏持久化的用户配置，并用
 * `configUpdatedAt` 记录最近一次有效变更时间，供设置同步层比较新旧。
 */
const useConfigStore = create(
  persist(
    (set) => ({
      language: initialLanguage,
      fontSize: 14,
      previewFontSize: 14,
      fontFamily: 'JetBrains Mono',
      lineHeight: 24,
      previewLineHeight: 24,
      previewZoomSync: true,
      tabSize: 2,
      wordWrap: true,
      lineNumbers: true,
      minimap: { enabled: false },
      backgroundImage: '',
      backgroundImageName: '',
      backgroundEnabled: false,
      backgroundTransparency: { dark: 80, light: 80 },
      autoSave: true,
      workspacePath: '',
      serverUrl: 'https://www.miaogu.xyz',
      // 云同步总开关：默认关闭。关闭时不渲染任何云入口，同步引擎也整体暂停。
      syncEnabled: false,
      configUpdatedAt: 0,
      syncableConfigUpdatedAt: 0,

      /**
       * 按单个键更新配置，并同步刷新配置时间戳。
       */
      setConfig: (key, value, meta = {}) => set((state) => ({
        ...state,
        [key]: value,
        configUpdatedAt: meta.updatedAt ?? Date.now(),
        syncableConfigUpdatedAt: DEVICE_LOCAL_CONFIG_KEYS.has(key)
          ? state.syncableConfigUpdatedAt
          : meta.updatedAt ?? Date.now(),
      })),
      /**
       * 批量加载配置快照，常用于设置导入或云端配置回放。
       */
      loadConfig: (config, meta = {}) => set((state) => ({
        ...state,
        ...config,
        configUpdatedAt: meta.updatedAt ?? state.configUpdatedAt ?? Date.now(),
        syncableConfigUpdatedAt: Object.keys(config || {}).some(
          (key) => !DEVICE_LOCAL_CONFIG_KEYS.has(key)
        )
          ? meta.updatedAt ?? Date.now()
          : state.syncableConfigUpdatedAt,
      })),
    }),
    {
      name: 'mde-config',
    }
  )
);

export default useConfigStore;
