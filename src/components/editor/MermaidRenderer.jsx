import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'antd';
import mermaid from 'mermaid';

// 配置 Mermaid 的全局默认渲染参数，供预览面板首次加载时复用。
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: "'JetBrains Mono', Consolas, monospace",
  fontSize: 14,
  flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
  sequence: { useMaxWidth: true, mirrorActors: true },
  gantt: { useMaxWidth: true },
});

/**
 * Mermaid 图表渲染组件。
 * 负责接收 Markdown 中提取出的 Mermaid 源码，并根据当前明暗主题异步生成 SVG 预览；
 * 当渲染失败时，改为展示本地化错误提示，避免预览区域直接空白。
 */
/**
 * 去掉 mermaid 生成在 SVG 里的 <title> 元素。
 *
 * 那些 title 是 mermaid 自己加的，作用只有一个：hover 时弹浏览器的原生提示，
 * 内容与节点上可见的文字重复。它位于 SVG 内部，应用的 antd Tooltip 换不进去，
 * 因此在这里按 SVG 源码去掉。
 *
 * @param {string} svg mermaid 渲染出的 SVG 源码
 * @returns {string} 去掉 title 之后的 SVG 源码
 */
function stripMermaidTitles(svg) {
  return typeof svg === 'string' ? svg.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '') : svg;
}
function MermaidRenderer({ code, isDark }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [code]);

  useEffect(() => {
    if (!code || !visible) return;
    let cancelled = false;

    (async () => {
      try {
        // 每次渲染前同步主题，确保预览结果与编辑器当前外观保持一致。
        mermaid.initialize({
          theme: isDark ? 'dark' : 'default',
          startOnLoad: false,
          securityLevel: 'loose',
        });
        // 生成唯一渲染 ID，避免 Mermaid 在多次渲染时复用旧节点。
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) { setSvg(rendered); setError(null); }
      } catch (err) {
        // 将底层渲染异常转换为可读提示，供预览区域直接展示。
        if (!cancelled) { setError(err.message || t('preview.mermaidError')); setSvg(''); }
      }
    })();

    // 异步渲染未完成时组件可能已卸载，用标记避免后续状态回写。
    return () => { cancelled = true; };
  }, [code, isDark, t, visible]);

  if (error) {
    return (
      <div className="md-preview__mermaid md-preview__mermaid--error">
        <Alert
          type="error"
          showIcon
          message={t('preview.mermaidErrorTitle')}
          description={error}
          style={{ background: 'transparent', border: 'none', padding: 0 }}
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="md-preview__mermaid"
      dangerouslySetInnerHTML={{ __html: stripMermaidTitles(svg) }}
    />
  );
}

export default memo(MermaidRenderer);
