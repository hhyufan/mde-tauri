
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useEditorStore from '@store/useEditorStore';
import { SYNC_PROTOCOL_VERSION } from '@store/useSyncStore';
import i18n from '../i18n';

/**
 * 规范化 minimap 配置结构，避免同步快照里混入运行时噪声字段。
 */
function sanitizeMinimap(minimap) {
  return { enabled: !!minimap?.enabled };
}

/**
 * 汇总本地可同步设置快照。
 *
 * 统一采集配置、主题与编辑器布局状态，并输出带协议版本和更新时间的结构，
 * 供导出与云同步共用。
 */
export function getLocalSettingsSnapshot() {
  const config = useConfigStore.getState();
  const theme = useThemeStore.getState();
  const editor = useEditorStore.getState();
  const updatedAt = Math.max(
    Number(config.configUpdatedAt || 0),
    Number(theme.themeUpdatedAt || 0),
    Number(editor.uiStateUpdatedAt || 0),
  );

  return {
    theme: theme.theme,
    language: config.language,
    fontSize: config.fontSize,
    previewFontSize: config.previewFontSize,
    fontFamily: config.fontFamily,
    lineHeight: config.lineHeight,
    previewLineHeight: config.previewLineHeight,
    previewZoomSync: config.previewZoomSync,
    tabSize: config.tabSize,
    wordWrap: config.wordWrap,
    lineNumbers: config.lineNumbers,
    minimap: sanitizeMinimap(config.minimap),
    autoSave: config.autoSave,
    workspacePath: config.workspacePath,
    editorState: {
      sidebarVisible: editor.sidebarVisible,
      sidebarView: editor.sidebarView,
      viewMode: editor.viewMode,
      toolbarVisible: editor.toolbarVisible,
    },
    protocolVersion: SYNC_PROTOCOL_VERSION,
    updatedAt,
  };
}

/**
 * 把外部设置快照应用到本地各个 store。
 *
 * 仅回放允许同步的设置字段，不触碰标签页、文件列表等纯本地运行态。
 */
export function applySettingsSnapshot(snapshot = {}) {
  const updatedAt = Number(snapshot.updatedAt || Date.now());
  useThemeStore.getState().setTheme(snapshot.theme || 'light', { updatedAt });
  const language = snapshot.language ?? 'en';
  const fontSize = snapshot.fontSize ?? 14;
  const lineHeight = snapshot.lineHeight ?? 24;
  useConfigStore.getState().loadConfig({
    language,
    fontSize,
    previewFontSize: snapshot.previewFontSize ?? fontSize,
    fontFamily: snapshot.fontFamily || 'JetBrains Mono',
    lineHeight,
    previewLineHeight: snapshot.previewLineHeight ?? lineHeight,
    previewZoomSync: snapshot.previewZoomSync ?? true,
    tabSize: snapshot.tabSize ?? 2,
    wordWrap: snapshot.wordWrap ?? true,
    lineNumbers: snapshot.lineNumbers ?? true,
    minimap: sanitizeMinimap(snapshot.minimap),
    autoSave: snapshot.autoSave ?? true,
    workspacePath: snapshot.workspacePath ?? '',
  }, { updatedAt });
  i18n.changeLanguage(language === 'zh' ? 'zh' : 'en');
  useEditorStore.getState().applySyncedUiState(snapshot.editorState || {}, { updatedAt });
}

/**
 * 构造导出到文件时使用的设置载荷。
 */
export function buildSettingsExportPayload() {
  return {
    type: 'mde-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getLocalSettingsSnapshot(),
  };
}

/**
 * 解析导入的设置文本，兼容“整包对象”与“纯 settings 对象”两种格式。
 */
export function parseSettingsImportPayload(rawText) {
  const parsed = JSON.parse(rawText);
  const settings = parsed?.settings && typeof parsed.settings === 'object'
    ? parsed.settings
    : parsed;
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid settings payload');
  }
  return settings;
}
