import { useTranslation } from 'react-i18next';
import { Switch } from 'antd';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import MokiSprite from './MokiSprite';

/**
 * Moki 主题与人物设置。
 *
 * 主题切换有两种形态，随「人物显示」开关切换：
 * - 开启人物：大预览卡片。卡片就是画布，插画按单格比例等比缩小（约 3 倍），
 *   旧版塞进 88px 方框等于缩了 10 倍，必然发糊。
 * - 关闭人物：回到紧凑卡片（更名前的设计）——两列横卡、各自底色、右侧勾选，
 *   只是不再渲染插画。
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
      <div className={`moki-theme-cards ${showCharacter ? '' : 'moki-theme-cards--compact'}`}>
        {['light', 'dark'].map((mode) => (
          <button
            key={mode}
            type="button"
            className={[
              'moki-theme-card',
              showCharacter ? 'moki-theme-card--preview' : 'moki-theme-card--compact',
              `moki-theme-card--${mode}`,
            ].join(' ')}
            aria-pressed={theme === mode}
            onClick={() => setTheme(mode)}
          >
            {showCharacter && (
              <span className="moki-theme-card__art">
                <span className="moki-theme-card__bar" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <MokiSprite theme={mode} art="themes" />
                <span className="moki-theme-card__badge" aria-hidden="true">
                  {theme === mode ? '✓' : ''}
                </span>
              </span>
            )}
            <span className="moki-theme-card__meta">
              <strong>{t(`moki.theme.${mode}`)}</strong>
              <small>{t(`moki.theme.${mode}Desc`)}</small>
            </span>
            {!showCharacter && (
              <span className="moki-theme-card__check" aria-hidden="true">
                {theme === mode ? '✓' : '○'}
              </span>
            )}
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
