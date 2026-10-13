import iconUrl from '@/assets/app-icon.png';
import mokiIconUrl from '@/assets/moki-icon.png';
import { cn } from '@utils/classNames';
import './app-mark.scss';

/**
 * 应用标识：直接使用软件图标（蓝色圆形底 + 白色 M，右竖笔画收成下箭头）。
 *
 * 侧栏品牌区与设置「关于」共用同一个组件，保证界面里的标识与任务栏、安装包
 * 使用的图标完全一致；尺寸通过内联变量下发，圆形裁切与投影由样式负责。
 *
 * `variant='moki'` 时改用 Moki 形象徽章，由设置里的「Moki 图标」开关控制，
 * 只影响传入该值的调用点。
 *
 * @param {{ size?: number, className?: string, variant?: 'app'|'moki' }} props
 *   尺寸、附加类名，以及使用哪一张标识。
 * @returns {JSX.Element} 品牌标识
 */
export default function AppMark({ size = 32, className, variant = 'app' }) {
  return (
    <img
      className={cn('app-mark', variant === 'moki' && 'app-mark--moki', className)}
      src={variant === 'moki' ? mokiIconUrl : iconUrl}
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{ '--app-mark-size': `${size}px` }}
    />
  );
}
