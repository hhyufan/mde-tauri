import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useDemoClock from './useDemoClock';
import useDemoComplete from './useDemoComplete';

const source =
  '# 写下新的想法\n\n## 从灵感开始\n\n让 **文字** 自然流淌。\n\n> 好的想法，值得记录。\n\n- [x] 记录今天的灵感\n- [ ] 写下新的故事';

export default function SplitDemo({ onComplete }) {
  const elapsed = useDemoClock();
  const count = Math.max(0, Math.min(source.length, Math.floor((elapsed - 450) / 75)));
  const text = source.slice(0, count);
  useDemoComplete(count === source.length, onComplete);
  return (
    <div className="scene-editor-split" data-complete={count === source.length}>
      <div className="scene-code" aria-label="Markdown 源码自动输入演示">
        {text.split('\n').map((line, index, lines) => (
          <div key={index}>
            <span className="scene-line-number">{index + 1}</span>
            <span
              className={
                line.startsWith('#')
                  ? 'scene-token-heading'
                  : line.startsWith('>')
                    ? 'scene-token-quote'
                    : ''
              }
            >
              {line || '\u200b'}
              {index === lines.length - 1 && (
                <span className="scene-typing-caret" aria-hidden="true" />
              )}
            </span>
          </div>
        ))}
      </div>
      <div
        className="md-preview scene-markdown scene-split-preview"
        aria-label="随输入实时渲染的预览"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}
