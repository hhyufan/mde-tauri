import { useTranslation } from 'react-i18next';
import { Switch } from 'antd';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import MokiSprite from './MokiSprite';

/**
 * Moki 主题与人物设置。
 *
 * 主题切换改用「卡片即预览画布」：插画区就是 1:1 的方形画布，插画按画布高度铺满，
 * 缩幅只有约 3 倍。旧版把插画塞进 88px 的方框，等于把近 1000px 的原图缩 11 倍，必然发糊。
 * 人物由「显示人物」开关统一控制：关闭后仅留渐变画布，主题卡片与欢迎页都不再出现角色。
 */
export default function MokiSettings({ SettingGroup, SettingRow }) {
  const { t } = useTranslation();
  const config = useConfigStore();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const showCharacter = config.mokiDisplay !== 'hidden';

  return (
    <>
      <SettingGroup label={t('moki.settingsTitle')} />
      <div className="moki-theme-cards">
        {['light', 'dark'].map((mode) => (
          <button
            key={mode}
            type="button"
            className={`moki-theme-card moki-theme-card--${mode}`}
            aria-pressed={theme === mode}
            onClick={() => setTheme(mode)}
          >
            <span className="moki-theme-card__art">
              <span className="moki-theme-card__bar" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {showCharacter && <MokiSprite theme={mode} art="themes" />}
              <span className="moki-theme-card__badge" aria-hidden="true">
                {theme === mode ? '✓' : ''}
              </span>
            </span>
            <span className="moki-theme-card__meta">
              <strong>{t(`moki.theme.${mode}`)}</strong>
              <small>{t(`moki.theme.${mode}Desc`)}</small>
            </span>
          </button>
        ))}
      </div>
      <SettingRow label={t('moki.display')} desc={t('moki.displayDesc')}>
        <Switch
          aria-label={t('moki.display')}
          checked={showCharacter}
          onChange={(value) => config.setConfig('mokiDisplay', value ? 'welcome' : 'hidden')}
        />
      </SettingRow>
    </>
  );
}
