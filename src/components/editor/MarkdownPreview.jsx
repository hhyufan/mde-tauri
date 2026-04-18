import { useMemo, useEffect, useRef, createElement, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Prism from 'prismjs';
import 'prismjs/plugins/autoloader/prism-autoloader';
import i18n from '@/i18n';
import useEditorStore from '@store/useEditorStore';
import useToastStore from '@store/useToastStore';
import { parseFootnotes, addFootnoteJumpHandlers } from '@utils/footnoteParser';
import MermaidRenderer from './MermaidRenderer';
import './markdown-preview.scss';

Prism.plugins.autoloader.languages_path =
  'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';

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

function MarkdownPreview({ className }) {
  const activeTab = useEditorStore((s) => s.getActiveTab());
  const rawContent = activeTab?.content || '';
  const containerRef = useRef(null);

  const content = useMemo(() => {
    const { content: processed } = parseFootnotes(rawContent);
    return processed;
  }, [rawContent]);

  // Load Prism theme CSS based on current theme
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

  // Init theme + watch for theme changes
  useEffect(() => {
    loadPrismTheme();
    const observer = new MutationObserver(() => loadPrismTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      document.getElementById('prism-theme')?.remove();
    };
  }, [loadPrismTheme]);

  // Add lang-tag buttons to code blocks (miaogu-notepad style)
  const addLangTags = useCallback((container) => {
    if (!container) return;
    container.querySelectorAll('.lang-tag').forEach((el) => el.remove());

    const toast = useToastStore.getState().toast;
    container.querySelectorAll('pre').forEach((pre) => {
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

      pre.style.position = 'relative';
      pre.appendChild(tag);
    });
  }, []);

  // Run Prism highlight + lang-tags + footnote handlers after content renders
  useEffect(() => {
    const timer = setTimeout(() => {
      if (containerRef.current) {
        Prism.highlightAllUnder(containerRef.current);
        addLangTags(containerRef.current);
      }
      addFootnoteJumpHandlers(containerRef.current);
    }, 80);
    return () => clearTimeout(timer);
  }, [content, addLangTags]);

  // Outline jump
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

  return (
    <div ref={containerRef} className={`md-preview ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownPreview;
