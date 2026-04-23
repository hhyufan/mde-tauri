import { useEffect, useRef, useState } from 'react';
import { Alert } from 'antd';
import mermaid from 'mermaid';

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

function MermaidRenderer({ code, isDark }) {
  const ref = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    (async () => {
      try {
        mermaid.initialize({
          theme: isDark ? 'dark' : 'default',
          startOnLoad: false,
          securityLevel: 'loose',
        });
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) { setSvg(rendered); setError(null); }
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Mermaid render failed'); setSvg(''); }
      }
    })();

    return () => { cancelled = true; };
  }, [code, isDark]);

  if (error) {
    return (
      <div className="md-preview__mermaid md-preview__mermaid--error">
        <Alert
          type="error"
          showIcon
          message="Mermaid Error"
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
