import useThemeStore from '@store/useThemeStore';
import bustAtlas from '@/assets/characters/moki-day-night-bust.png';
import themeAtlas from '@/assets/characters/moki-themes.png';
import statusAtlas from '@/assets/characters/moki-status-empty.png';
import historyLight from '@/assets/characters/history-empty-light.png';
import historyDark from '@/assets/characters/history-empty-dark.png';
import './moki.scss';

/**
 * 人物立绘精灵。
 *
 * 素材有两种排布：
 * - 双格图集（`src` 是单张图）：浅色在左、深色在右，靠 background-position 取半格。
 *   用于 bust（欢迎页主视觉）与 themes（主题切换卡片）。
 * - 独立两张（`single: true`，`src` 是 { light, dark }）：一态一张，直接铺满。
 *   用于 history —— 它的两态构图不同（白天/夜晚两套场景），拼成一张会被中线切断。
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
  // 本地历史为空时的立绘：Moki 趴在「文档 = 文档 ✓」的窗口上，旁边是回环箭头与时钟，
  // 语义正好是「这里没有任何改动」。浅色/深色各一张独立素材（1254×1254 正方形）。
  // 这两张图本身就是完整构图的成品，直接整张显示即可，不做重心微调。
  history: {
    single: true,
    src: { light: historyLight, dark: historyDark },
  },
};

export default function MokiSprite({ theme: explicitTheme, art = 'bust' }) {
  const theme = useThemeStore((state) => state.theme);
  const mode = (explicitTheme || theme) === 'dark' ? 'dark' : 'light';
  // 未收录的 art 回落到 bust；类名用兜底后的键，样式才能按素材比例对齐。
  const atlasKey = ATLASES[art] ? art : 'bust';
  const atlas = ATLASES[atlasKey];
  return (
    <span aria-hidden="true" className={`moki-sprite moki-sprite--${mode} moki-sprite--${atlasKey}`}>
      {/* 两帧各占一层：切换主题时靠交叉淡入淡出完成"换装"，硬切会显得生硬（见 moki.scss）。 */}
      {['light', 'dark'].map((frame) => {
        // 没给偏移的素材（构图本身就是成品）就整张居中显示，不做微调。
        const offset = atlas.offset?.[frame] || atlas.offset?.light || { left: '0%', top: '0%' };
        return (
          <span
            key={frame}
            className={`moki-sprite__art moki-sprite__art--${frame}`}
            style={{
              backgroundImage: `url(${atlas.single ? atlas.src[frame] : atlas.src})`,
              // 双格图集靠定位取半格；独立素材直接从头铺满。
              backgroundPosition: atlas.single ? '0% 0%' : `${frame === 'dark' ? 100 : 0}% 0%`,
              left: offset.left,
              top: offset.top,
            }}
          />
        );
      })}
    </span>
  );
}
