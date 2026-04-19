import {
  useMemo,
  useEffect,
  useRef,
  createElement,
  useCallback,
  useDeferredValue,
  memo,
} from 'react';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Prism from 'prismjs';
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
import useEditorStore from '@store/useEditorStore';
import useToastStore from '@store/useToastStore';
import { parseFootnotes, addFootnoteJumpHandlers } from '@utils/footnoteParser';
import MermaidRenderer from './MermaidRenderer';
import './markdown-preview.scss';

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

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

function getLangDisplay(raw) {
  const key = (raw || '').toLowerCase();
  return LANG_DISPLAY[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

const sanitizeSchema = {
  ...defaultSchema,
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
    sup: ['id', 'class'],
    li: ['id'],
    ol: ['start'],
  },
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
];

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

// Heavy parse + VDOM build is isolated in its own memoized component so
// that unrelated parent re-renders (theme toggles, scroll, focus, etc.)
// don't trigger a fresh ReactMarkdown pass on long documents.
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

function MarkdownPreview({ className }) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const fallback = useMemo(() => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    return tab?.content || '';
  }, [activeTabId]);
  const rawContent = useEditorBufferContent(activeTabId, fallback, 240);
  const containerRef = useRef(null);

  const processedContent = useMemo(() => {
    const { content: processed } = parseFootnotes(rawContent);
    return processed;
  }, [rawContent]);

  // useDeferredValue lets React render the heavy markdown tree at a
  // lower priority. While the new tree is being built, the previous
  // tree stays interactive — this is what keeps the editor / scrollbar
  // / sidebar from freezing on long documents.
  const content = useDeferredValue(processedContent);

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

  // Idempotent: only adds a tag to a <pre> that doesn't already have one.
  // Previously this removed every tag and re-created them on each render,
  // which churned the DOM and forced layout on long documents.
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

  // Incremental, idle-time syntax highlighting. Code blocks that already
  // contain Prism tokens are skipped, so re-renders that didn't actually
  // change a given block cost zero highlighting work.
  const idleJobRef = useRef(null);

  const cancelHighlightJob = useCallback(() => {
    if (idleJobRef.current != null) {
      cancelIdle(idleJobRef.current);
      idleJobRef.current = null;
    }
  }, []);

  const scheduleHighlight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    cancelHighlightJob();

    const pending = [];
    container.querySelectorAll('pre > code[class*="language-"]').forEach((codeEl) => {
      // If the first child is already a Prism token span we've nothing
      // to do — React only resets the code element's children when the
      // text actually changed.
      if (codeEl.querySelector(':scope > .token')) return;
      // Skip mermaid (rendered via MermaidRenderer, not Prism).
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
          // Ignore: a malformed code block shouldn't break the loop.
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

  // Schedule highlighting + footnote handlers after the deferred render
  // commits. We wait one frame so the DOM is stable.
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
              target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  }), []);

  const isStale = content !== processedContent;

  return (
    <div
      ref={containerRef}
      className={`md-preview ${isStale ? 'md-preview--stale' : ''} ${className || ''}`}
    >
      <MarkdownView content={content} components={components} />
    </div>
  );
}

export default MarkdownPreview;
