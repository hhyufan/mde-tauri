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
  bust: { src: bustAtlas, offset: { light: { left: '-3.4%', top: '0%' }, dark: { left: '3.2%', top: '0%' } } },
  // 偏移按素材实测的“不透明像素重心”换算（重心对挥手这类细长手臂不敏感，
  // 比包围盒中心更接近人眼判断）：浅色格重心 X=55.75%/Y=40.58%，深色格 X=46.94%/Y=50.28%。
  // 纵向只补一半——浅色人物内容高度占到 92.7%，整量下移会让脚被裁掉。
  themes: {
    src: themeAtlas,
    offset: {
      light: { left: '-5.75%', top: '5%' },
      dark: { left: '3.06%', top: '0%' },
    },
  },
};

export default function MokiSprite({ theme: explicitTheme, art = 'bust' }) {
  const theme = useThemeStore((state) => state.theme);
  const mode = (explicitTheme || theme) === 'dark' ? 'dark' : 'light';
  const atlas = ATLASES[art] || ATLASES.bust;
  const offset = atlas.offset[mode] || atlas.offset.light;
  return (
    <span aria-hidden="true" className={`moki-sprite moki-sprite--${mode}`}>
      <span
        className="moki-sprite__art"
        style={{
          backgroundImage: `url(${atlas.src})`,
          backgroundPosition: `${mode === 'dark' ? 100 : 0}% 0%`,
          left: offset.left,
          top: offset.top,
        }}
      />
    </span>
  );
}
