import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useEditorStore from '@store/useEditorStore';
import { SYNC_PROTOCOL_VERSION } from '@store/useSyncStore';
import i18n from '../i18n';

function sanitizeMinimap(minimap) {
  return { enabled: !!minimap?.enabled };
}

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
    fontFamily: config.fontFamily,
    lineHeight: config.lineHeight,
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

export function applySettingsSnapshot(snapshot = {}) {
  const updatedAt = Number(snapshot.updatedAt || Date.now());
  useThemeStore.getState().setTheme(snapshot.theme || 'light', { updatedAt });
  const language = snapshot.language ?? 'en';
  useConfigStore.getState().loadConfig({
    language,
    fontSize: snapshot.fontSize ?? 14,
    fontFamily: snapshot.fontFamily || 'JetBrains Mono',
    lineHeight: snapshot.lineHeight ?? 24,
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

export function buildSettingsExportPayload() {
  return {
    type: 'mde-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getLocalSettingsSnapshot(),
  };
}

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
