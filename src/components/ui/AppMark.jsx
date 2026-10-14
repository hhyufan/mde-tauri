// 应用图标：取自 icon.icns 里的 1024×1024 原图（项目内最高清的图标源）。
// 显示端的锯齿来自 CSS 的圆形硬裁切，已在 app-mark.scss 中去除，与此处无关。
import iconUrl from '@/assets/app-icon.png';
import mokiIconUrl from '@/assets/moki-icon.png';
// 完整产品字标：左侧圆形 M 图标 + 手绘圆体「MokiDown」，两者是一体构图，
// 不能拆开单独使用，因此按整张图以高度为准等比缩放。
import wordmarkUrl from '@/assets/mokidown-wordmark.webp';
import { cn } from '@utils/classNames';
import './app-mark.scss';

/**
 * 应用标识。
 *
 * - `variant='app'`（默认）：软件图标（蓝色圆形底 + 白色 M），与任务栏、安装包一致，
 *   固定在正方形内显示。
 * - `variant='moki'`：Moki 形象徽章，由设置里的「Moki 图标」开关控制。
 * - `variant='wordmark'`：完整 MokiDown 字标。它是横向组合标识，**按高度等比缩放**，
 *   因此 `size` 在它这里表示高度而非边长；调用方需自行约束可用宽度。
 *
 * 尺寸通过内联变量下发，圆形裁切与投影由样式负责。
 *
 * @param {{ size?: number, className?: string, variant?: 'app'|'moki'|'wordmark' }} props
 *   尺寸（wordmark 下为高度）、附加类名，以及使用哪一张标识。
 * @returns {JSX.Element} 品牌标识
 */
export default function AppMark({ size = 32, className, variant = 'app' }) {
  const isWordmark = variant === 'wordmark';
  const src = isWordmark ? wordmarkUrl : variant === 'moki' ? mokiIconUrl : iconUrl;

  return (
    <img
      className={cn(
        'app-mark',
        variant === 'moki' && 'app-mark--moki',
        isWordmark && 'app-mark--wordmark',
        className,
      )}
      src={src}
      alt=""
      {...(isWordmark ? { height: size } : { width: size, height: size })}
      draggable={false}
      style={{ '--app-mark-size': `${size}px` }}
    />
  );
}
