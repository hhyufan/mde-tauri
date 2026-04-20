import { useState } from 'react';
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
  general: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  appearance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="13.5" cy="6.5" r="2.5" /><circle cx="19" cy="13" r="2" /><circle cx="15.5" cy="19.5" r="1.5" /><circle cx="6" cy="12" r="3" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9-10-9z" /></svg>,
  editor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  cloud: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>,
};
const NAV_ITEMS = [
  { id: 'general' },
  { id: 'appearance' },
  { id: 'editor' },
  { id: 'cloud' },
];

function SettingsModal({ open, onClose }) {
  const { t, i18n } = useTranslation();
  const [activeNav, setActiveNav] = useState('general');
  const [cloudBusy, setCloudBusy] = useState(false);
  const config = useConfigStore();
  const { theme, setTheme } = useThemeStore();
  const { isLoggedIn, user, logout } = useAuthStore();
  const notify = useNotificationStore((s) => s.notify);

  if (!open) return null;

  function handleChange(key, value) {
    config.setConfig(key, value);
    if (key === 'language') {
      i18n.changeLanguage(value === 'zh' ? 'zh' : 'en');
    }
  }

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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal__header">
          <h2>{t('settings.title')}</h2>
          <button className="settings-modal__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="settings-modal__body">
          <nav className="settings-modal__nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`settings-modal__nav-item ${activeNav === item.id ? 'settings-modal__nav-item--active' : ''}`}
                onClick={() => setActiveNav(item.id)}
              >
                <span className="settings-modal__nav-icon">{NAV_ICONS[item.id]}</span>
                <span>{t(`settings.nav.${item.id}`)}</span>
              </button>
            ))}
          </nav>

          <div className="settings-modal__content">
            {activeNav === 'general' && (
              <div className="settings-section">
                <SettingRow
                  label={t('settings.general.language')}
                  desc={t('settings.general.languageDesc')}
                >
                  <select
                    value={config.language}
                    onChange={(e) => handleChange('language', e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </SettingRow>
                <SettingRow
                  label={t('settings.general.startup')}
                  desc={t('settings.general.startupDesc')}
                >
                  <ToggleSwitch
                    checked={config.autoSave}
                    onChange={(v) => handleChange('autoSave', v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.general.workspacePath')}
                  desc=""
                >
                  <input
                    type="text"
                    value={config.workspacePath}
                    onChange={(e) => handleChange('workspacePath', e.target.value)}
                    placeholder="/path/to/workspace"
                  />
                </SettingRow>
              </div>
            )}

            {activeNav === 'appearance' && (
              <div className="settings-section">
                <SettingRow
                  label={t('settings.appearance.colorTheme')}
                  desc={t('settings.appearance.colorThemeDesc')}
                >
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </SettingRow>
                <SettingRow
                  label={t('settings.appearance.fontSize')}
                  desc=""
                >
                  <input
                    type="number"
                    min={10}
                    max={24}
                    value={config.fontSize}
                    onChange={(e) => handleChange('fontSize', Number(e.target.value))}
                  />
                </SettingRow>
              </div>
            )}

            {activeNav === 'editor' && (
              <div className="settings-section">
                <SettingRow
                  label={t('settings.editor.tabSize')}
                  desc={t('settings.editor.tabSizeDesc')}
                >
                  <select
                    value={config.tabSize}
                    onChange={(e) => handleChange('tabSize', Number(e.target.value))}
                  >
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                  </select>
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.wordWrap')}
                  desc={t('settings.editor.wordWrapDesc')}
                >
                  <ToggleSwitch
                    checked={config.wordWrap}
                    onChange={(v) => handleChange('wordWrap', v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.lineNumbers')}
                  desc={t('settings.editor.lineNumbersDesc')}
                >
                  <ToggleSwitch
                    checked={config.lineNumbers}
                    onChange={(v) => handleChange('lineNumbers', v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.minimap')}
                  desc={t('settings.editor.minimapDesc')}
                >
                  <ToggleSwitch
                    checked={config.minimap?.enabled ?? false}
                    onChange={(v) => handleChange('minimap', { enabled: v })}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.fontFamily')}
                  desc={t('settings.editor.fontFamilyDesc')}
                >
                  <select
                    value={config.fontFamily}
                    onChange={(e) => handleChange('fontFamily', e.target.value)}
                  >
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Fira Code">Fira Code</option>
                    <option value="Cascadia Code">Cascadia Code</option>
                    <option value="Consolas">Consolas</option>
                    <option value="monospace">Monospace</option>
                  </select>
                </SettingRow>
                <SettingRow
                  label={t('settings.editor.autoSave')}
                  desc={t('settings.editor.autoSaveDesc')}
                >
                  <ToggleSwitch
                    checked={config.autoSave}
                    onChange={(v) => handleChange('autoSave', v)}
                  />
                </SettingRow>
              </div>
            )}

            {activeNav === 'cloud' && (
              <div className="settings-section">
                <SettingRow
                  label={t('settings.cloud.serverUrl')}
                  desc={t('settings.cloud.serverUrlDesc')}
                >
                  <input
                    type="text"
                    value={config.serverUrl}
                    onChange={(e) => handleChange('serverUrl', e.target.value)}
                    placeholder="https://www.miaogu.xyz"
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.cloud.syncEnabled')}
                  desc={t('settings.cloud.syncEnabledDesc')}
                >
                  <ToggleSwitch
                    checked={config.syncEnabled}
                    onChange={(v) => handleChange('syncEnabled', v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t('settings.cloud.account')}
                  desc={isLoggedIn ? user?.email : t('settings.cloud.notLoggedIn')}
                >
                  {isLoggedIn ? (
                    <button
                      className="setting-row__danger-btn"
                      onClick={logout}
                    >
                      {t('auth.logout')}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
                  )}
                </SettingRow>
                <SettingRow
                  label={t('settings.cloud.syncSettings')}
                  desc={t('settings.cloud.syncSettingsDesc')}
                >
                  <div className="setting-row__actions">
                    <button
                      className="setting-row__action-btn"
                      onClick={handleSyncSettings}
                      disabled={!isLoggedIn || cloudBusy}
                    >
                      {t('sync.syncNow')}
                    </button>
                    <button
                      className="setting-row__action-btn"
                      onClick={handlePullSettings}
                      disabled={!isLoggedIn || cloudBusy}
                    >
                      {t('settings.cloud.pullSettings')}
                    </button>
                  </div>
                </SettingRow>
                <SettingRow
                  label={t('settings.cloud.settingsJson')}
                  desc={t('settings.cloud.settingsJsonDesc')}
                >
                  <div className="setting-row__actions">
                    <button
                      className="setting-row__action-btn"
                      onClick={handleExportJson}
                      disabled={cloudBusy}
                    >
                      {t('settings.cloud.exportJson')}
                    </button>
                    <button
                      className="setting-row__action-btn"
                      onClick={handleImportJson}
                      disabled={cloudBusy}
                    >
                      {t('settings.cloud.importJson')}
                    </button>
                  </div>
                </SettingRow>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className="toggle-switch__thumb" />
    </button>
  );
}

export default SettingsModal;
