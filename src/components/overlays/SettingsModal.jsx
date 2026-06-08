/**
 * 设置弹窗模块。
 *
 * 汇总应用配置相关的展示与交互入口，覆盖常规偏好、编辑器外观、
 * 云同步设置，以及设置快照的导入导出流程。
 */
import { useState } from 'react';
import { Modal, Menu, Switch, Select, Input, InputNumber, Button, Space } from 'antd';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import {
  SettingOutlined,
  BgColorsOutlined,
  EditOutlined,
  CloudOutlined,
  PlusOutlined,
  MinusOutlined,
  SyncOutlined,
  CloudDownloadOutlined,
  ExportOutlined,
  ImportOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useAuthStore from '@store/useAuthStore';
import useNotificationStore from '@store/useNotificationStore';
import syncEngine from '../../services/syncEngine';
import {
  applySettingsSnapshot,
  buildSettingsExportPayload,
  parseSettingsImportPayload,
} from '@utils/settingsSync';
import './settings-modal.scss';

const NAV_ICONS = {
  general: <SettingOutlined />,
  appearance: <BgColorsOutlined />,
  editor: <EditOutlined />,
  cloud: <CloudOutlined />,
};

const NAV_KEYS = ['general', 'appearance', 'editor', 'cloud'];

/**
 * 设置弹窗。
 *
 * 按分类集中管理工作区、外观、编辑器与云同步相关配置，并提供设置导入导出、
 * 云端同步与账号状态展示。
 *
 * @param {object} props 组件属性。
 * @param {boolean} props.open 控制弹窗显示状态。
 * @param {() => void} props.onClose 关闭弹窗的回调。
 */
function SettingsModal({ open: openProp, onClose }) {
  const { t, i18n } = useTranslation();
  const [activeNav, setActiveNav] = useState('general');
  const [cloudBusy, setCloudBusy] = useState(false);
  const config = useConfigStore();
  const { theme, setTheme } = useThemeStore();
  const { isLoggedIn, user, logout } = useAuthStore();
  const notify = useNotificationStore((s) => s.notify);
  const { isMobileLayout, isPortrait } = useResponsiveLayout();
  // 手机竖屏下把设置面板当作全屏抽屉处理，给内部双栏布局留出纵向堆叠空间；
  // 横屏移动端横向空间更充足，因此仍保留左右并排布局。
  const fullScreen = isMobileLayout && isPortrait;

  /**
   * 写入设置项，并在语言切换时同步更新国际化实例。
   *
   * @param {string} key 配置键名。
   * @param {unknown} value 目标配置值。
   */
  function handleChange(key, value) {
    config.setConfig(key, value);
    if (key === 'language') {
      i18n.changeLanguage(value === 'zh' ? 'zh' : 'en');
    }
  }

  /**
   * 将本地设置主动推送到云端。
   *
   * @returns {Promise<void>} 同步完成后更新忙碌状态并给出通知。
   */
  async function handleSyncSettings() {
    if (!isLoggedIn) return;
    setCloudBusy(true);
    try {
      await syncEngine.syncConfig();
      notify('success', t('settings.cloud.syncSettings'), t('settings.cloud.syncSuccess'));
    } catch (err) {
      notify('error', t('notification.error'), err?.message || t('sync.status.error'));
    } finally {
      setCloudBusy(false);
    }
  }

  /**
   * 从云端拉取设置并覆盖当前本地配置快照。
   *
   * @returns {Promise<void>} 拉取完成后同步语言并提示结果。
   */
  async function handlePullSettings() {
    if (!isLoggedIn) return;
    setCloudBusy(true);
    try {
      const remote = await syncEngine.syncConfig({ preferRemote: true });
      if (remote?.language) {
        i18n.changeLanguage(remote.language === 'zh' ? 'zh' : 'en');
      }
      notify('success', t('settings.cloud.pullSettings'), t('settings.cloud.pullSuccess'));
    } catch (err) {
      notify('error', t('notification.error'), err?.message || t('sync.status.error'));
    } finally {
      setCloudBusy(false);
    }
  }

  /**
   * 导出当前设置快照为本地 JSON 文件。
   *
   * @returns {Promise<void>} 导出结束后重置忙碌状态。
   */
  async function handleExportJson() {
    setCloudBusy(true);
    try {
      const path = await save({
        defaultPath: 'mde-settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      const payload = buildSettingsExportPayload();
      await writeTextFile(path, JSON.stringify(payload, null, 2));
      notify('success', t('settings.cloud.exportJson'), t('settings.cloud.exportSuccess'));
    } catch (err) {
      notify('error', t('notification.error'), err?.message || String(err));
    } finally {
      setCloudBusy(false);
    }
  }

  /**
   * 从本地 JSON 文件导入设置快照并立即应用。
   *
   * @returns {Promise<void>} 导入完成后同步语言并提示结果。
   */
  async function handleImportJson() {
    setCloudBusy(true);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path || Array.isArray(path)) return;
      const raw = await readTextFile(path);
      const settings = parseSettingsImportPayload(raw);
      applySettingsSnapshot(settings);
      i18n.changeLanguage((settings.language || 'en') === 'zh' ? 'zh' : 'en');
      notify('success', t('settings.cloud.importJson'), t('settings.cloud.importSuccess'));
    } catch (err) {
      notify('error', t('notification.error'), err?.message || String(err));
    } finally {
      setCloudBusy(false);
    }
  }

  const menuItems = NAV_KEYS.map((key) => ({
    key,
    icon: NAV_ICONS[key],
    label: t(`settings.nav.${key}`),
  }));

  return (
    <Modal
      open={openProp}
      onCancel={onClose}
      footer={null}
      width={fullScreen ? '100vw' : 760}
      centered={!fullScreen}
      style={fullScreen ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : undefined}
      destroyOnHidden
      maskClosable
      closable
      rootClassName={`mde-settings-modal-root${fullScreen ? ' mde-settings-modal-root--fullscreen' : ''}`}
      styles={{ body: { padding: 0 }, content: { padding: 0 } }}
      title={null}
    >
      <div className={`settings-modal${fullScreen ? ' settings-modal--fullscreen' : ''}`}>
        <div className="settings-modal__header">
          <div className="settings-modal__header-left">
            <div className="settings-modal__header-icon">
              {NAV_ICONS[activeNav]}
            </div>
            <div>
              <h2>{t('settings.title')}</h2>
              <span className="settings-modal__header-sub">{t(`settings.nav.${activeNav}`)}</span>
            </div>
          </div>
        </div>

        {fullScreen && (
          <Menu
            className="settings-modal__tabs"
            mode="horizontal"
            selectedKeys={[activeNav]}
            onClick={({ key }) => setActiveNav(key)}
            items={menuItems}
            overflowedIndicator={null}
          />
        )}

        <div className="settings-modal__body">
          {!fullScreen && (
            <Menu
              className="settings-modal__nav"
              mode="inline"
              selectedKeys={[activeNav]}
              onClick={({ key }) => setActiveNav(key)}
              items={menuItems}
              style={{ width: 180 }}
            />
          )}

          <div className="settings-modal__content">
            {activeNav === 'general' && (
              <div className="settings-section">
                <SettingGroup label={t('settings.group.workspace')} />
                <SettingRow
                  label={t('settings.general.language')}
                  desc={t('settings.general.languageDesc')}
                >
                  <Select
                    style={{ width: 160 }}
                    value={config.language}
                    onChange={(v) => handleChange('language', v)}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'zh', label: '中文' },
                    ]}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.general.workspacePath')}
                  desc={t('settings.general.workspacePathDesc')}
                >
                  <Input
                    style={{ width: 260 }}
                    value={config.workspacePath}
                    onChange={(e) => handleChange('workspacePath', e.target.value)}
                    placeholder="/path/to/workspace"
                  />
                </SettingRow>
                <SettingGroup label={t('settings.group.behavior')} />
                <SettingRow
                  label={t('settings.general.startup')}
                  desc={t('settings.general.startupDesc')}
                >
                  <Switch
                    checked={config.autoSave}
                    onChange={(v) => handleChange('autoSave', v)}
                  />
                </SettingRow>
              </div>
            )}

            {activeNav === 'appearance' && (
              <div className="settings-section">
                <SettingGroup label={t('settings.group.theme')} />
                <SettingRow
                  label={t('settings.appearance.colorTheme')}
                  desc={t('settings.appearance.colorThemeDesc')}
                >
                  <div className="setting-theme-picker">
                    <button
                      className={`setting-theme-btn ${theme === 'light' ? 'setting-theme-btn--active' : ''}`}
                      onClick={() => setTheme('light')}
                      type="button"
                    >
                      <span className="setting-theme-btn__swatch setting-theme-btn__swatch--light" />
                      Light
                    </button>
                    <button
                      className={`setting-theme-btn ${theme === 'dark' ? 'setting-theme-btn--active' : ''}`}
                      onClick={() => setTheme('dark')}
                      type="button"
                    >
                      <span className="setting-theme-btn__swatch setting-theme-btn__swatch--dark" />
                      Dark
                    </button>
                  </div>
                </SettingRow>
                <SettingGroup label={t('settings.group.typography')} />
                <SettingRow
                  label={t('settings.appearance.previewZoomSync')}
                  desc={t('settings.appearance.previewZoomSyncDesc')}
                >
                  <Switch
                    checked={config.previewZoomSync ?? true}
                    onChange={(v) => handleChange('previewZoomSync', v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.appearance.previewFontSize')}
                  desc={t('settings.appearance.previewFontSizeDesc')}
                >
                  <InputNumber
                    min={10}
                    max={24}
                    step={1}
                    disabled={config.previewZoomSync ?? true}
                    value={config.previewFontSize ?? config.fontSize ?? 14}
                    onChange={(v) => handleChange('previewFontSize', Number(v) || config.fontSize || 14)}
                    addonBefore={
                      <Button
                        type="text"
                        size="small"
                        disabled={config.previewZoomSync ?? true}
                        icon={<MinusOutlined />}
                        onClick={() => handleChange(
                          'previewFontSize',
                          Math.max(10, ((config.previewFontSize ?? config.fontSize) || 14) - 1)
                        )}
                      />
                    }
                    addonAfter={
                      <Button
                        type="text"
                        size="small"
                        disabled={config.previewZoomSync ?? true}
                        icon={<PlusOutlined />}
                        onClick={() => handleChange(
                          'previewFontSize',
                          Math.min(24, ((config.previewFontSize ?? config.fontSize) || 14) + 1)
                        )}
                      />
                    }
                    style={{ width: 180 }}
                  />
                </SettingRow>
              </div>
            )}

            {activeNav === 'editor' && (
              <div className="settings-section">
                <SettingGroup label={t('settings.group.font')} />
                <SettingRow
                  label={t('settings.editor.fontSize')}
                  desc={t('settings.editor.fontSizeDesc')}
                >
                  <InputNumber
                    min={10}
                    max={24}
                    step={1}
                    value={config.fontSize}
                    onChange={(v) => handleChange('fontSize', Number(v) || 14)}
                    addonBefore={
                      <Button
                        type="text"
                        size="small"
                        icon={<MinusOutlined />}
                        onClick={() => handleChange('fontSize', Math.max(10, (config.fontSize || 14) - 1))}
                      />
                    }
                    addonAfter={
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => handleChange('fontSize', Math.min(24, (config.fontSize || 14) + 1))}
                      />
                    }
                    style={{ width: 180 }}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.fontFamily')}
                  desc={t('settings.editor.fontFamilyDesc')}
                >
                  <Select
                    style={{ width: 200 }}
                    value={config.fontFamily}
                    onChange={(v) => handleChange('fontFamily', v)}
                    options={[
                      { value: 'JetBrains Mono', label: 'JetBrains Mono' },
                      { value: 'Fira Code', label: 'Fira Code' },
                      { value: 'Cascadia Code', label: 'Cascadia Code' },
                      { value: 'Consolas', label: 'Consolas' },
                      { value: 'monospace', label: 'Monospace' },
                    ]}
                  />
                </SettingRow>
                <SettingGroup label={t('settings.group.formatting')} />
                <SettingRow
                  label={t('settings.editor.tabSize')}
                  desc={t('settings.editor.tabSizeDesc')}
                >
                  <Select
                    style={{ width: 100 }}
                    value={config.tabSize}
                    onChange={(v) => handleChange('tabSize', Number(v))}
                    options={[
                      { value: 2, label: '2' },
                      { value: 4, label: '4' },
                      { value: 8, label: '8' },
                    ]}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.wordWrap')}
                  desc={t('settings.editor.wordWrapDesc')}
                >
                  <Switch
                    checked={config.wordWrap}
                    onChange={(v) => handleChange('wordWrap', v)}
                  />
                </SettingRow>
                <SettingGroup label={t('settings.group.display')} />
                <SettingRow
                  label={t('settings.editor.lineNumbers')}
                  desc={t('settings.editor.lineNumbersDesc')}
                >
                  <Switch
                    checked={config.lineNumbers}
                    onChange={(v) => handleChange('lineNumbers', v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.minimap')}
                  desc={t('settings.editor.minimapDesc')}
                >
                  <Switch
                    checked={config.minimap?.enabled ?? false}
                    onChange={(v) => handleChange('minimap', { enabled: v })}
                  />
                </SettingRow>
                <SettingGroup label={t('settings.group.file')} />
                <SettingRow
                  label={t('settings.editor.autoSave')}
                  desc={t('settings.editor.autoSaveDesc')}
                >
                  <Switch
                    checked={config.autoSave}
                    onChange={(v) => handleChange('autoSave', v)}
                  />
                </SettingRow>
              </div>
            )}

            {activeNav === 'cloud' && (
              <div className="settings-section">
                <SettingGroup label={t('settings.group.connection')} />
                <SettingRow
                  label={t('settings.cloud.serverUrl')}
                  desc={t('settings.cloud.serverUrlDesc')}
                >
                  <Input
                    style={{ width: 260 }}
                    value={config.serverUrl}
                    onChange={(e) => handleChange('serverUrl', e.target.value)}
                    placeholder="https://www.miaogu.xyz"
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.cloud.syncEnabled')}
                  desc={t('settings.cloud.syncEnabledDesc')}
                >
                  <Switch
                    checked={config.syncEnabled}
                    onChange={(v) => handleChange('syncEnabled', v)}
                  />
                </SettingRow>
                <SettingGroup label={t('settings.group.account')} />
                <SettingRow
                  label={t('settings.cloud.account')}
                  desc={isLoggedIn ? user?.email : t('settings.cloud.notLoggedIn')}
                >
                  {isLoggedIn ? (
                    <Button danger icon={<LogoutOutlined />} onClick={logout}>
                      {t('auth.logout')}
                    </Button>
                  ) : (
                    <span className="setting-row__empty">—</span>
                  )}
                </SettingRow>
                <SettingGroup label={t('settings.group.sync')} />
                <SettingRow
                  label={t('settings.cloud.syncSettings')}
                  desc={t('settings.cloud.syncSettingsDesc')}
                >
                  <Space>
                    <Button
                      icon={<SyncOutlined />}
                      onClick={handleSyncSettings}
                      disabled={!isLoggedIn || cloudBusy}
                      loading={cloudBusy}
                    >
                      {t('sync.syncNow')}
                    </Button>
                    <Button
                      icon={<CloudDownloadOutlined />}
                      onClick={handlePullSettings}
                      disabled={!isLoggedIn || cloudBusy}
                      loading={cloudBusy}
                    >
                      {t('settings.cloud.pullSettings')}
                    </Button>
                  </Space>
                </SettingRow>
                <SettingRow
                  label={t('settings.cloud.settingsJson')}
                  desc={t('settings.cloud.settingsJsonDesc')}
                >
                  <Space>
                    <Button
                      icon={<ExportOutlined />}
                      onClick={handleExportJson}
                      disabled={cloudBusy}
                    >
                      {t('settings.cloud.exportJson')}
                    </Button>
                    <Button
                      icon={<ImportOutlined />}
                      onClick={handleImportJson}
                      disabled={cloudBusy}
                    >
                      {t('settings.cloud.importJson')}
                    </Button>
                  </Space>
                </SettingRow>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 设置分组标题。
 *
 * @param {object} props 组件属性。
 * @param {React.ReactNode} props.label 分组标题文本。
 */
function SettingGroup({ label }) {
  return (
    <div className="settings-group">
      <span className="settings-group__label">{label}</span>
    </div>
  );
}

/**
 * 单条设置项行布局。
 *
 * @param {object} props 组件属性。
 * @param {React.ReactNode} props.label 设置项名称。
 * @param {React.ReactNode} props.desc 设置项说明文本。
 * @param {React.ReactNode} props.children 设置控件内容。
 */
function SettingRow({ label, desc, children }) {
  return (
    <div className="setting-row">
      <div className="setting-row__info">
        <span className="setting-row__label">{label}</span>
        {desc && <span className="setting-row__desc">{desc}</span>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
}

export default SettingsModal;
