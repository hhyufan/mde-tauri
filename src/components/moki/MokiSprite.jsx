import useThemeStore from '@store/useThemeStore';
import bustAtlas from '@/assets/characters/moki-day-night-bust.png';
import themeAtlas from '@/assets/characters/moki-themes.png';
import './moki.scss';

/**
 * 人物立绘精灵。
 *
 * 两张素材都是「浅色在左、深色在右」的双格图集：
 * - bust  ：半身特写，用于欢迎页主视觉；
 * - themes：全身对图，用于主题切换卡片——卡片画布更大，全身比例更完整，
 *           也正好避开把近 1000px 的原图缩到几十像素导致的发糊。
 *
 * 服装明暗由传入的 theme 决定，未传时跟随界面主题。
 */
const ATLASES = {
  bust: { src: bustAtlas, offset: { light: '-3.4%', dark: '3.2%' } },
  themes: { src: themeAtlas, offset: { light: '0%', dark: '0%' } },
};

export default function MokiSprite({ theme: explicitTheme, art = 'bust' }) {
  const theme = useThemeStore((state) => state.theme);
  const mode = (explicitTheme || theme) === 'dark' ? 'dark' : 'light';
  const atlas = ATLASES[art] || ATLASES.bust;
  return (
    <span aria-hidden="true" className={`moki-sprite moki-sprite--${mode}`}>
      <span
        className="moki-sprite__art"
        style={{
          backgroundImage: `url(${atlas.src})`,
          backgroundPosition: `${mode === 'dark' ? 100 : 0}% 0%`,
          left: atlas.offset[mode],
        }}
      />
    </span>
  );
}
