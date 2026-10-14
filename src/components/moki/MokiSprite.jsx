import useThemeStore from '@store/useThemeStore';
import bustAtlas from '@/assets/characters/moki-day-night-bust.png';
import themeAtlas from '@/assets/characters/moki-themes.png';
import statusAtlas from '@/assets/characters/moki-status-empty.png';
import historyAtlas from '@/assets/characters/moki-history-empty.png';
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
  // 空状态专用立绘（887×887 方形单格，重心几乎居中，仅轻微上移）。
  status: {
    src: statusAtlas,
    offset: {
      light: { left: '-1.45%', top: '-3.85%' },
      dark: { left: '0.85%', top: '-4.41%' },
    },
  },
  // 本地历史为空时的立绘：Moki 趴在「文档 = 文档 ✓」的窗口上，
  // 旁边是回环箭头与时钟，语义正好是「这里没有任何改动」。
  // 规格与 themes 相同（1672×941，半格 836×941），偏移同样按实测重心换算：
  // 浅色格重心 X=51.43%/Y=54.91%，深色格 X=49.76%/Y=55.58%，纵向只补一半。
  history: {
    src: historyAtlas,
    offset: {
      light: { left: '-1.43%', top: '-2.45%' },
      dark: { left: '0.24%', top: '-2.79%' },
    },
  },
};

export default function MokiSprite({ theme: explicitTheme, art = 'bust' }) {
  const theme = useThemeStore((state) => state.theme);
  const mode = (explicitTheme || theme) === 'dark' ? 'dark' : 'light';
  // 未收录的 art 回落到 bust；类名用兜底后的键，样式才能按图集比例对齐。
  const atlasKey = ATLASES[art] ? art : 'bust';
  const atlas = ATLASES[atlasKey];
  return (
    <span aria-hidden="true" className={`moki-sprite moki-sprite--${mode} moki-sprite--${atlasKey}`}>
      {/* 两帧各占一层：切换主题时靠交叉淡入淡出完成"换装"，
          比直接改 background-position 硬切更像人物状态变化（见 moki.scss）。 */}
      {['light', 'dark'].map((frame) => {
        const offset = atlas.offset[frame] || atlas.offset.light;
        return (
          <span
            key={frame}
            className={`moki-sprite__art moki-sprite__art--${frame}`}
            style={{
              backgroundImage: `url(${atlas.src})`,
              backgroundPosition: `${frame === 'dark' ? 100 : 0}% 0%`,
              left: offset.left,
              top: offset.top,
            }}
          />
        );
      })}
    </span>
  );
}
