/**
 * @file Markdown 只读预览组件。
 *
 * 该文件负责将编辑器缓冲区内容转换为增强版 Markdown 预览，并串联脚注、
 * 代码高亮、Mermaid、数学公式、图片解析与大纲跳转等预览侧能力。
 */
import {
  useMemo,
  useEffect,
  useRef,
  createElement,
  useCallback,
  useDeferredValue,
  memo,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Prism from 'prismjs';
import 'katex/dist/katex.min.css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-sass';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-dart';
import i18n from '@/i18n';
import { useFileManager } from '@hooks/useFileManager';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import useToastStore from '@store/useToastStore';
import { parseFootnotes, addFootnoteJumpHandlers } from '@utils/footnoteParser';
import { loadMarkdownImageSrc, parseMarkdownLineHint, resolveMarkdownLinkPath } from '@utils/markdownAssets';
import MermaidRenderer from './MermaidRenderer';
import './markdown-preview.scss';

/**
 * 将标题文本归一化为可复用的锚点标识。
 *
 * @param {string} text 原始标题文本。
 * @returns {string} 适合挂载到 DOM `id` 的 slug。
 */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * 在预览容器内查找以指定文本开头的列表项。
 *
 * @param {HTMLElement} container 预览容器根节点。
 * @param {string} text 需要匹配的列表项文本前缀。
 * @returns {HTMLElement|null} 命中的列表项元素。
 */
function findListElement(container, text) {
  const candidates = container.querySelectorAll('li');
  for (const el of candidates) {
    if (el.textContent.trim().startsWith(text.trim())) return el;
  }
  return null;
}

const LANG_DISPLAY = {
  html: 'HTML', xml: 'XML', sql: 'SQL', css: 'CSS', cpp: 'C++',
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', php: 'PHP', md: 'Markdown',
  yml: 'YAML', yaml: 'YAML', json: 'JSON', rb: 'Ruby', java: 'Java',
  c: 'C', go: 'Go', rust: 'Rust', kotlin: 'Kotlin', swift: 'Swift',
  scss: 'SCSS', sass: 'Sass', bash: 'Bash', shell: 'Shell', sh: 'Shell',
  mermaid: 'Mermaid', jsx: 'JSX', tsx: 'TSX', vue: 'Vue',
  toml: 'TOML', ini: 'INI', lua: 'Lua', r: 'R', dart: 'Dart',
};

/**
 * 将代码块语言标识转换为用户可读的展示名称。
 *
 * @param {string} raw Markdown 代码块声明中的原始语言名。
 * @returns {string} 用于语言标签展示的名称。
 */
function getLangDisplay(raw) {
  const key = (raw || '').toLowerCase();
  return LANG_DISPLAY[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  clobber: [],
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'span', 'div', 'section', 'details', 'summary', 'sup', 'sub',
    'ins', 'del', 'mark', 'abbr', 'ruby', 'rt', 'rp',
    'dl', 'dt', 'dd', 'figure', 'figcaption', 'kbd', 'var', 'samp',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class', 'style', 'id'],
    a: [...(defaultSchema.attributes?.a || []), 'id', 'className', 'class'],
    code: [...(defaultSchema.attributes?.code || []), 'className', 'class'],
    span: [...(defaultSchema.attributes?.span || []), 'className', 'class', 'style', 'id'],
    div: [...(defaultSchema.attributes?.div || []), 'className', 'class', 'style'],
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'title', 'width', 'height', 'className', 'class'],
    sup: ['id', 'class'],
    li: ['id', 'className', 'class'],
    ul: ['className', 'class'],
    ol: ['start', 'className', 'class'],
    input: ['type', 'checked', 'disabled', 'className', 'class'],
  },
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
];

/**
 * 渲染 Markdown 代码节点，并按语言分流到普通代码、高亮代码或 Mermaid 组件。
 *
 * @param {object} props React Markdown 注入的代码节点属性。
 * @returns {JSX.Element} 代码节点对应的渲染结果。
 */
function CodeBlock({ children, className, ...props }) {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const code = String(children).replace(/\n$/, '');

  if (lang === 'mermaid') {
    const isDark = document.documentElement.dataset.theme === 'dark';
    return <MermaidRenderer code={code} isDark={isDark} />;
  }

  if (!match) {
    return <code className={className} {...props}>{children}</code>;
  }

  return <code className={`language-${lang}`} {...props}>{children}</code>;
}

/**
 * 为指定标题标签生成自动附带锚点 `id` 的渲染器。
 *
 * @param {keyof JSX.IntrinsicElements} tag 标题标签名。
 * @returns {Function} 供 React Markdown 使用的标题渲染函数。
 */
function makeHeading(tag) {
  return function Heading({ children, ...props }) {
    const text = typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : c?.props?.children ?? '')).join('')
        : '';
    const id = slugify(text);
    return createElement(tag, { id, ...props }, children);
  };
}

/**
 * 解析 Markdown 图片路径，并在组件生命周期内管理对象 URL。
 *
 * @param {object} props 图片节点属性。
 * @returns {JSX.Element} 解析后的图片元素。
 */
function MarkdownImage({ src, alt, documentPath, ...props }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    setResolvedSrc(src);
    loadMarkdownImageSrc(src, documentPath).then((result) => {
      if (cancelled) {
        if (result.objectUrl) URL.revokeObjectURL(result.objectUrl);
        return;
      }
      objectUrl = result.objectUrl;
      setResolvedSrc(result.src || src);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentPath, src]);

  return <img src={resolvedSrc} alt={alt || ''} loading="lazy" {...props} />;
}

// 较重的 Markdown 解析与 VDOM 构建被隔离到独立的 `memo` 组件中，避免主题
// 切换、滚动、焦点变化等无关父级更新反复重跑整棵长文档渲染树。
/**
 * 负责实际提交 React Markdown 树的记忆化视图层。
 *
 * @param {object} props 预处理后的 Markdown 内容与节点渲染配置。
 * @returns {JSX.Element} 预览树根节点。
 */
const MarkdownView = memo(function MarkdownView({ content, components }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});

const requestIdle =
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback.bind(window)
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 16, didTimeout: false }), 16);

const cancelIdle =
  typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function'
    ? window.cancelIdleCallback.bind(window)
    : (id) => clearTimeout(id);

/**
 * Markdown 预览主组件。
 *
 * 从编辑器缓冲区读取正文，完成预处理、增量高亮和预览交互接线，并根据
 * 编辑器或预览配置同步字号、行高与主题相关行为。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} Markdown 预览面板。
 */
const MarkdownPreview = forwardRef(function MarkdownPreview({ className }, ref) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const editorFontSize = useConfigStore((s) => s.fontSize);
  const editorLineHeight = useConfigStore((s) => s.lineHeight);
  const previewFontSize = useConfigStore((s) => s.previewFontSize);
  const previewLineHeight = useConfigStore((s) => s.previewLineHeight);
  const previewZoomSync = useConfigStore((s) => s.previewZoomSync);
  const { openFileFromPath } = useFileManager();
  const activeTab = useMemo(() => {
    return useEditorStore.getState().tabs.find((t) => t.id === activeTabId) || null;
  }, [activeTabId]);
  const fallback = activeTab?.content || '';
  const documentPath = activeTab?.path || '';
  const rawContent = useEditorBufferContent(activeTabId, fallback, 240);
  const containerRef = useRef(null);

  const processedContent = useMemo(() => {
    const { content: processed } = parseFootnotes(rawContent);
    return processed;
  }, [rawContent]);

  // `useDeferredValue` 会把较重的 Markdown 树渲染降到较低优先级处理。新的
  // 预览树尚在构建时，旧树仍然保持可交互，从而降低长文档下编辑器、滚动条
  // 与侧边栏一起卡顿的概率。
  const content = useDeferredValue(processedContent);

  /**
   * 根据当前主题动态装载 Prism 样式表。
   */
  const loadPrismTheme = useCallback(() => {
    const existing = document.getElementById('prism-theme');
    if (existing) existing.remove();

    const isDark = document.documentElement.dataset.theme === 'dark';
    const link = document.createElement('link');
    link.id = 'prism-theme';
    link.rel = 'stylesheet';
    link.href = isDark ? '/prism-one-dark.css' : '/prism-one-light.css';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    loadPrismTheme();
    const observer = new MutationObserver(() => loadPrismTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      document.getElementById('prism-theme')?.remove();
    };
  }, [loadPrismTheme]);

  // 代码块语言标签以幂等方式补入：只给尚未添加标签的 `<pre>` 追加按钮，
  // 避免每次渲染都先删后建，造成长文档下不必要的 DOM 抖动和重排。
  /**
   * 为已识别语言的代码块补充复制入口与语言标签。
   *
   * @param {HTMLElement|null} container 当前预览容器。
   */
  const addLangTags = useCallback((container) => {
    if (!container) return;

    const toast = useToastStore.getState().toast;
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector(':scope > .lang-tag')) return;
      const code = pre.querySelector('code[class*="language-"]');
      if (!code) return;

      const langClass = [...code.classList].find((c) => c.startsWith('language-'));
      const rawLang = langClass ? langClass.replace('language-', '') : '';
      const displayLang = getLangDisplay(rawLang);

      const tag = document.createElement('button');
      tag.className = 'lang-tag';
      tag.textContent = displayLang;
      tag.title = i18n.t('preview.copiedToClipboard');
      tag.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent || '').then(() => {
          toast(i18n.t('preview.copiedToClipboard'));
        }).catch(() => {
          toast(i18n.t('preview.copyFailed'));
        });
      });

      if (!pre.style.position) pre.style.position = 'relative';
      pre.appendChild(tag);
    });
  }, []);

  // 语法高亮在空闲时间分批执行。已经包含 Prism token 的代码块会被跳过，
  // 因此未发生正文变化的重渲染几乎不再产生额外高亮成本。
  const idleJobRef = useRef(null);

  /**
   * 取消尚未执行完成的空闲高亮任务。
   */
  const cancelHighlightJob = useCallback(() => {
    if (idleJobRef.current != null) {
      cancelIdle(idleJobRef.current);
      idleJobRef.current = null;
    }
  }, []);

  /**
   * 在浏览器空闲时间内分批执行 Prism 高亮，并在完成后补挂语言标签。
   */
  const scheduleHighlight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    cancelHighlightJob();

    const pending = [];
    container.querySelectorAll('pre > code[class*="language-"]').forEach((codeEl) => {
      // 若首层子节点已经是 Prism token，说明这个代码块已高亮完成；只有正文
      // 真正变化时，React 才会重置 `code` 节点的子内容。
      if (codeEl.querySelector(':scope > .token')) return;
      // Mermaid 由专门的 `MermaidRenderer` 处理，这里不走 Prism 高亮。
      if (codeEl.classList.contains('language-mermaid')) return;
      pending.push(codeEl);
    });

    if (pending.length === 0) {
      addLangTags(container);
      return;
    }

    let i = 0;
    const work = (deadline) => {
      idleJobRef.current = null;
      const hasTime = () =>
        deadline.didTimeout || (deadline.timeRemaining && deadline.timeRemaining() > 4);

      while (i < pending.length && hasTime()) {
        const el = pending[i++];
        try {
          Prism.highlightElement(el);
        } catch (_) {
          // 单个代码块语法异常不应打断整批高亮任务。
        }
      }

      if (i < pending.length) {
        idleJobRef.current = requestIdle(work, { timeout: 500 });
      } else {
        addLangTags(container);
      }
    };

    idleJobRef.current = requestIdle(work, { timeout: 500 });
  }, [addLangTags, cancelHighlightJob]);

  // 延迟渲染提交后，再在下一帧补挂代码高亮与脚注跳转，确保目标 DOM 已稳定。
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      raf = 0;
      scheduleHighlight();
      addFootnoteJumpHandlers(containerRef.current);
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      cancelHighlightJob();
    };
  }, [content, scheduleHighlight, cancelHighlightJob]);

  useEffect(() => {
    const handler = (e) => {
      const { text, type } = e.detail ?? {};
      const container = containerRef.current;
      if (!container || !text) return;

      let target = null;
      if (type === 'heading') {
        target = container.querySelector(`#${CSS.escape(slugify(text))}`);
      } else {
        target = findListElement(container, text);
      }
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.addEventListener('outline:jump', handler);
    return () => window.removeEventListener('outline:jump', handler);
  }, []);

  /**
   * 处理 Markdown 普通链接点击。
   *
   * 对当前文档可解析的本地相对路径，改为在应用内打开到编辑器标签；
   * 其他外链仍保留浏览器默认新窗口行为。
   */
  const handleLinkClick = useCallback(async (e, href) => {
    const anchor = e.currentTarget;
    const target = resolveMarkdownLinkPath(href, documentPath);
    if (!target.internal || !target.path) return;
    e.preventDefault();
    const fileName = target.path.split(/[\\/]/).pop() || target.path;
    await openFileFromPath(target.path, fileName);
    const lineHint = parseMarkdownLineHint(target.hash)
      || parseMarkdownLineHint([
        anchor?.textContent || '',
        anchor?.getAttribute?.('aria-label') || '',
        anchor?.querySelector?.('img')?.getAttribute?.('alt') || '',
        anchor?.querySelector?.('img')?.getAttribute?.('title') || '',
      ].filter(Boolean).join(' '));
    if (lineHint?.line) {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('editor:jump-to-line', {
          detail: { line: lineHint.line },
        }));
      }, 150);
    }
  }, [documentPath, openFileFromPath]);

  const components = useMemo(() => ({
    code: CodeBlock,
    pre: ({ children, ...props }) => <pre style={{ position: 'relative' }} {...props}>{children}</pre>,
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    h5: makeHeading('h5'),
    h6: makeHeading('h6'),
    a: ({ href, children, id, ...props }) => {
      if (href?.startsWith('#')) {
        return (
          <a
            href={href}
            id={id}
            onClick={(e) => {
              e.preventDefault();
              const target = containerRef.current?.querySelector(`#${CSS.escape(href.slice(1))}`);
              if (!target) return;
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              target.classList.add('footnote-highlight');
              window.setTimeout(() => target.classList.remove('footnote-highlight'), 1200);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }
      const target = resolveMarkdownLinkPath(href, documentPath);
      if (target.internal && target.path) {
        return (
          <a
            href={target.path}
            id={id}
            onClick={(e) => {
              handleLinkClick(e, href);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }
      return <a href={href} id={id} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
    table: ({ children, ...props }) => (
      <div className="md-preview__table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),
    input: ({ type, checked, ...props }) => {
      if (type === 'checkbox') {
        return <input type="checkbox" checked={checked} readOnly {...props} />;
      }
      return <input type={type} {...props} />;
    },
    details: ({ children, ...props }) => <details {...props}>{children}</details>,
    summary: ({ children, ...props }) => <summary {...props}>{children}</summary>,
    del: ({ children }) => <del>{children}</del>,
    mark: ({ children }) => <mark>{children}</mark>,
    sup: ({ children, ...props }) => <sup {...props}>{children}</sup>,
    sub: ({ children }) => <sub>{children}</sub>,
    abbr: ({ children, ...props }) => <abbr {...props}>{children}</abbr>,
    kbd: ({ children }) => <kbd className="md-preview__kbd">{children}</kbd>,
    img: ({ src, alt, ...props }) => (
      <MarkdownImage src={src} alt={alt} documentPath={documentPath} {...props} />
    ),
  }), [documentPath, handleLinkClick]);

  const isStale = content !== processedContent;
  const fontSize = previewZoomSync ? editorFontSize : (previewFontSize || editorFontSize);
  const lineHeight = previewZoomSync ? editorLineHeight : (previewLineHeight || editorLineHeight);

  useImperativeHandle(ref, () => ({
    getScrollContainer: () => containerRef.current,
  }), []);

  return (
    <div
      ref={containerRef}
      className={`md-preview ${isStale ? 'md-preview--stale' : ''} ${className || ''}`}
      style={{
        fontSize: `${fontSize || 14}px`,
        lineHeight: (lineHeight || 24) / (fontSize || 14),
      }}
    >
      <MarkdownView content={content} components={components} />
    </div>
  );
});

export default MarkdownPreview;
