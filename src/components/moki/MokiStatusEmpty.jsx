import useConfigStore from '@store/useConfigStore';
import MokiSprite from './MokiSprite';
import './moki-status-empty.scss';

/**
 * 统一的空状态展示。
 *
 * 文件树、大纲、最近、搜索四处空状态共用一套结构：
 * 人物立绘 + 一句 ACG 风格的主句 + 底部一行淡色说明（“底部增加文字”那一条）。
 *
 * 人物沿用「人物显示」总开关：关闭时只剩文字，与主题卡、欢迎页、关于页的行为保持一致。
 * 动效只做极轻的呼吸感，并在 prefers-reduced-motion 下整体停用（见样式文件）。
 *
 * @param {object} props 组件属性。
 * @param {string} props.title 主句，建议一句 ACG 风格的口语。
 * @param {string} [props.hint] 底部说明，讲清“怎么做才能不空”。
 * @param {'bust'|'themes'|null} [props.art] 使用哪套立绘；传 null 表示这一处不出人物。
 * @param {boolean} [props.compact] 紧凑模式：用于搜索下拉这类高度受限的容器。
 */
export default function MokiStatusEmpty({ title, hint, art = 'status', compact = false }) {
  // 直接订阅布尔值，避免空状态因为无关配置变化而重渲染。
  const showCharacter = useConfigStore((state) => state.mokiDisplay !== 'hidden');
  const withArt = showCharacter && Boolean(art);
  return (
    <div
      className={`moki-status-empty${compact ? ' moki-status-empty--compact' : ''}${
        withArt ? '' : ' moki-status-empty--plain'
      }`}
    >
      {withArt && (
        <div className="moki-status-empty__art" aria-hidden="true">
          <MokiSprite art={art} />
        </div>
      )}
      <p className="moki-status-empty__title">{title}</p>
      {hint && <p className="moki-status-empty__hint">{hint}</p>}
    </div>
  );
}
