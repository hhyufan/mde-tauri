import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import {
  applySettingsSnapshot,
  getLocalSettingsSnapshot,
} from './settingsSync';

const DEVICE_LOCAL_STATE = {
  workspacePath: 'C:\\workspaces\\local-notes',
  serverUrl: 'https://local-sync.example.test',
  syncEnabled: true,
};

function resetSettingsStores() {
  useConfigStore.setState({
    language: 'en',
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
    autoSave: true,
    ...DEVICE_LOCAL_STATE,
    configUpdatedAt: 100,
    syncableConfigUpdatedAt: 100,
  });
  useThemeStore.setState({ theme: 'light', themeUpdatedAt: 0 });
  useEditorStore.setState({
    sidebarVisible: true,
    sidebarView: 'explorer',
    viewMode: 'edit',
    toolbarVisible: true,
    uiStateUpdatedAt: 0,
  });
}

describe('device-local settings isolation', () => {
  beforeEach(() => {
    resetSettingsStores();
  });

  afterAll(() => {
    resetSettingsStores();
  });

  it.each([
    ['workspacePath', 'D:\\private-workspace'],
    ['serverUrl', 'https://another-device.example.test'],
    ['syncEnabled', false],
  ])('does not advance the cloud clock when %s changes', (key, value) => {
    useConfigStore.getState().setConfig(key, value, { updatedAt: 5_000 });

    const config = useConfigStore.getState();
    expect(config[key]).toBe(value);
    expect(config.configUpdatedAt).toBe(5_000);
    expect(config.syncableConfigUpdatedAt).toBe(100);
    expect(getLocalSettingsSnapshot().updatedAt).toBe(100);
  });

  it('keeps the cloud clock stable when a batch contains only device-local keys', () => {
    useConfigStore.getState().loadConfig({
      workspacePath: 'E:\\batch-workspace',
      serverUrl: 'https://batch-device.example.test',
      syncEnabled: false,
    }, { updatedAt: 8_000 });

    const config = useConfigStore.getState();
    expect(config.configUpdatedAt).toBe(8_000);
    expect(config.syncableConfigUpdatedAt).toBe(100);
    expect(getLocalSettingsSnapshot().updatedAt).toBe(100);
  });

  it('omits all device-local settings from the cloud snapshot', () => {
    const snapshot = getLocalSettingsSnapshot();

    expect(snapshot).not.toHaveProperty('workspacePath');
    expect(snapshot).not.toHaveProperty('serverUrl');
    expect(snapshot).not.toHaveProperty('syncEnabled');
    expect(snapshot).toMatchObject({
      language: 'en',
      fontSize: 14,
      updatedAt: 100,
    });
  });

  it('does not overwrite device-local values when applying a cloud snapshot', () => {
    applySettingsSnapshot({
      language: 'en',
      fontSize: 18,
      workspacePath: '/remote/workspace',
      serverUrl: 'https://remote-server.example.test',
      syncEnabled: false,
      updatedAt: 9_000,
    }, { includeDeviceLocal: false });

    expect(useConfigStore.getState()).toMatchObject({
      fontSize: 18,
      ...DEVICE_LOCAL_STATE,
    });
  });
});
