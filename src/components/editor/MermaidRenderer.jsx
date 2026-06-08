import { useEffect, useRef, useState } from 'react';
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
function MermaidRenderer({ code, isDark }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) return;
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
  }, [code, isDark]);

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
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default MermaidRenderer;
