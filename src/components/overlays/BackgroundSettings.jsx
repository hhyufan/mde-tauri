import { useRef, useState } from 'react';
import { Button, Slider, Space, Switch } from 'antd';
import { DeleteOutlined, PictureOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useNotificationStore from '@store/useNotificationStore';
import { useBackgroundImage } from '@hooks/useBackgroundImage';
import {
  deleteBackgroundImage,
  getBackgroundTransparency,
  saveBackgroundImage,
  validateBackgroundImage,
} from '@utils/backgroundImage';

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

export default function BackgroundSettings({ SettingGroup, SettingRow }) {
  const { t } = useTranslation();
  const config = useConfigStore();
  const theme = useThemeStore((state) => state.theme);
  const notify = useNotificationStore((state) => state.notify);
  const { url, error } = useBackgroundImage();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function installImage(blob, name) {
    await validateBackgroundImage(blob);
    const id = await saveBackgroundImage(blob);
    const previous = useConfigStore.getState().backgroundImage;
    try {
      config.loadConfig(
        { backgroundImage: id, backgroundImageName: name, backgroundEnabled: true },
        { updatedAt: Date.now() },
      );
    } catch (failure) {
      await deleteBackgroundImage(id);
      throw failure;
    }
    await deleteBackgroundImage(previous).catch(() => {});
  }

  async function selectImage() {
    if (!window.__TAURI_INTERNALS__) {
      input.current?.click();
      return;
    }
    setBusy(true);
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: t('settings.background.images'), extensions: Object.keys(IMAGE_TYPES) }],
      });
      if (!path) return;
      const name = path.split(/[\\/]/).pop();
      const type = IMAGE_TYPES[name.split('.').pop().toLowerCase()];
      await installImage(new Blob([await readFile(path)], { type }), name);
    } catch {
      notify('error', t('notification.error'), t('settings.background.error'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await installImage(file, file.name);
    } catch {
      notify('error', t('notification.error'), t('settings.background.error'));
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    const id = config.backgroundImage;
    config.loadConfig(
      { backgroundImage: '', backgroundImageName: '', backgroundEnabled: false },
      { updatedAt: Date.now() },
    );
    await deleteBackgroundImage(id).catch(() => {});
  }

  return (
    <>
      <SettingGroup label={t('settings.background.title')} />
      <SettingRow
        label={t('settings.background.enable')}
        desc={t('settings.background.enableDesc')}
      >
        <Switch
          aria-label={t('settings.background.enable')}
          checked={config.backgroundEnabled}
          disabled={busy}
          onChange={(checked) => config.setConfig('backgroundEnabled', checked)}
        />
      </SettingRow>
      <SettingRow
        label={t('settings.background.image')}
        desc={config.backgroundImageName || t('settings.background.imageDesc')}
      >
        <Space>
          <Button icon={<PictureOutlined aria-hidden="true" />} loading={busy} onClick={selectImage}>
            {t('settings.background.select')}
          </Button>
          {config.backgroundImage && (
            <Button danger icon={<DeleteOutlined aria-hidden="true" />} disabled={busy} onClick={removeImage}>
              {t('settings.background.remove')}
            </Button>
          )}
        </Space>
        <input
          ref={input}
          type="file"
          hidden
          accept={Object.values(IMAGE_TYPES).join(',')}
          aria-label={t('settings.background.select')}
          onChange={uploadImage}
        />
      </SettingRow>
      {error && (
        <div className="setting-background__error" role="alert">
          {t('settings.background.error')}
        </div>
      )}
      {config.backgroundEnabled && (
        <>
          {['light', 'dark'].map((mode) => (
            <SettingRow
              key={mode}
              label={t(`settings.background.${mode}`)}
              desc={t('settings.background.transparencyDesc')}
            >
              <div className="setting-background__slider">
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  ariaLabelForHandle={t(`settings.background.${mode}`)}
                  value={getBackgroundTransparency(config.backgroundTransparency, mode)}
                  onChange={(value) =>
                    config.setConfig('backgroundTransparency', {
                      ...config.backgroundTransparency,
                      [mode]: value,
                    })
                  }
                  tooltip={{ formatter: (value) => `${value}%` }}
                />
                <span>{getBackgroundTransparency(config.backgroundTransparency, mode)}%</span>
              </div>
            </SettingRow>
          ))}
        </>
      )}
      {url && (
        <div className={`setting-background__preview setting-background__preview--${theme}`}>
          <img
            src={url}
            alt={t('settings.background.preview')}
            style={{
              opacity: config.backgroundEnabled
                ? (100 - getBackgroundTransparency(config.backgroundTransparency, theme)) / 100
                : 0,
            }}
          />
          <span>{t('settings.background.preview')}</span>
        </div>
      )}
    </>
  );
}
