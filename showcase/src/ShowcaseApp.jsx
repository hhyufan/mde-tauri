import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Modal,
  Segmented,
  Space,
  Tag,
  Tree,
} from 'antd';
import {
  MoonOutlined,
  SunOutlined,
  BranchesOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  FileOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import Prism from 'prismjs';
import 'katex/dist/katex.min.css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import useShowcaseTheme from './theme/useShowcaseTheme';
import {
  chapterFeatureIndex,
  featureIndex,
  paperMarkdown,
  showcaseMeta,
} from './data';

const MARKDOWN_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

function highlightCodeBlocks(root) {
  if (!root) return;

  root.querySelectorAll('pre code[class*="language-"]').forEach((element) => {
    try {
      Prism.highlightElement(element);
    } catch (_) {
      // 单个代码块高亮失败时不阻塞其他内容展示
    }
  });
}

function useDeferredPrismHighlight(containerRef, dependencies) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;

    let rafId = 0;
    let secondRafId = 0;
    let timeoutId = 0;

    const runHighlight = () => {
      highlightCodeBlocks(root);
    };

    // 首帧等待两次绘制提交后再高亮，避免第一次挂载时节点尚未稳定。
    rafId = window.requestAnimationFrame(() => {
      secondRafId = window.requestAnimationFrame(() => {
        runHighlight();
      });
    });
    // 再补一次短延迟高亮，覆盖异步内容或动画完成后的场景。
    timeoutId = window.setTimeout(() => {
      runHighlight();
    }, 120);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.cancelAnimationFrame(secondRafId);
      window.clearTimeout(timeoutId);
    };
  }, dependencies);
}

function basename(path) {
  return String(path || '').split('/').filter(Boolean).pop() || String(path || '');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[`*_~[\]()>#]/g, '')
    .replace(/[：:]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function flattenText(children) {
  if (Array.isArray(children)) return children.map((child) => flattenText(child)).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (children?.props?.children) return flattenText(children.props.children);
  return '';
}

function buildTreeData(files) {
  const root = [];
  const folderMap = new Map();
  const leafMap = new Map();

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let level = root;
    let currentPath = '';

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      const mapKey = `${isLeaf ? 'leaf' : 'dir'}:${currentPath}`;
      const targetMap = isLeaf ? leafMap : folderMap;

      if (!targetMap.has(mapKey)) {
        const node = {
          key: isLeaf ? `file:${file.key}` : `dir:${currentPath}`,
          title: isLeaf ? basename(file.path) : part,
          nodeType: isLeaf ? 'file' : 'dir',
          selectable: isLeaf,
          children: [],
        };
        targetMap.set(mapKey, node);
        level.push(node);
      }

      const node = targetMap.get(mapKey);
      if (!isLeaf) level = node.children;
    });
  }

  return root;
}

function formatLineRange(snippet) {
  if (!snippet?.lineStart || !snippet?.lineEnd) return '';
  return `L${snippet.lineStart}-${snippet.lineEnd}`;
}

function normalizePrismLanguage(language) {
  const normalized = String(language || '').trim().toLowerCase();
  const languageMap = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    scss: 'scss',
    css: 'css',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    sh: 'bash',
    shell: 'bash',
    kt: 'kotlin',
    rs: 'rust',
  };

  return languageMap[normalized] || normalized || 'text';
}

const FEATURE_TERM_STOP_WORDS = new Set([
  '',
  '系统',
  '模块',
  '功能',
  '能力',
  '编辑器',
  'markdown',
  'tauri',
  'react',
  'rust',
  '支持',
  '实现',
  '用于',
  '负责',
  '提供',
  '相关',
  '面向',
  '场景',
  '方案',
  '设计',
  '项目',
  '管理',
  '处理',
  '运行',
  '同步',
  '文件',
]);

function splitIntoSentences(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  return value.match(/[^。！？；]+[。！？；]?|\s+/g) || [value];
}

function buildFeatureTerms(feature) {
  const rawTerms = [
    feature?.title,
    feature?.title?.replace(/模块|能力|功能|方案|引擎$/g, ''),
    feature?.summary,
    feature?.overview,
  ].filter(Boolean);

  const derivedTerms = rawTerms.flatMap((term) =>
    String(term)
      .split(/[、，,；。/]|以及|以及|和|与|及|并|或|负责|用于|实现|支持|提供/g)
      .map((item) => item.trim())
  );

  return Array.from(
    new Set(
      [...rawTerms, ...derivedTerms]
        .map((term) => String(term || '').trim())
        .filter((term) => term && term.length >= 2)
        .filter((term) => !FEATURE_TERM_STOP_WORDS.has(normalizeText(term)))
    )
  ).sort((left, right) => right.length - left.length);
}

function findFeatureSentenceRange(sentence, feature) {
  const terms = buildFeatureTerms(feature);
  let bestMatch = null;

  for (const term of terms) {
    const start = sentence.indexOf(term);
    if (start < 0) continue;

    const score = term.length + (term === feature.title ? 6 : 0) + (term.length >= 6 ? 2 : 0);
    const nextMatch = {
      feature,
      score,
      term,
      start,
      end: start + term.length,
    };

    if (
      !bestMatch
      || nextMatch.score > bestMatch.score
      || (nextMatch.score === bestMatch.score && nextMatch.start < bestMatch.start)
    ) {
      bestMatch = nextMatch;
    }
  }

  return bestMatch;
}

function getSentenceFeatureMatches(sentence, chapter) {
  if (!String(sentence || '').trim() || !chapter?.features?.length) return [];

  const matches = chapter.features
    .map((feature) => findFeatureSentenceRange(sentence, feature))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  const specificMatches = matches.filter(({ feature, term }) => !/模块$/.test(feature.title) && term !== feature.title);
  const preferredMatches = specificMatches.length ? specificMatches : matches;
  const threshold = preferredMatches[0]?.score ? Math.max(preferredMatches[0].score - 3, 3) : 3;

  const selected = preferredMatches
    .filter(({ score }) => score >= threshold)
    .slice(0, 3);

  const acceptedRanges = [];
  return selected
    .filter((match) => {
      const overlaps = acceptedRanges.some(
        (range) => !(match.end <= range.start || match.start >= range.end)
      );
      if (overlaps) return false;
      acceptedRanges.push({ start: match.start, end: match.end });
      return true;
    })
    .sort((left, right) => left.start - right.start);
}

function renderInlineFootnotes(text, chapter, onFeatureClick) {
  const sentences = splitIntoSentences(text);
  const consumed = new Set();

  return sentences.flatMap((sentence, sentenceIndex) => {
    const matchedFeatures = /\S/.test(sentence)
      ? getSentenceFeatureMatches(sentence, chapter).filter((feature) => {
          if (consumed.has(feature.feature.id)) return false;
          consumed.add(feature.feature.id);
          return true;
        })
      : [];

    if (!matchedFeatures.length) {
      return [sentence];
    }

    const content = [];
    let cursor = 0;

    matchedFeatures.forEach((match, matchIndex) => {
      if (match.start > cursor) {
        content.push(sentence.slice(cursor, match.start));
      }

      content.push(
        <span
          key={`highlight-${sentenceIndex}-${matchIndex}`}
          className="showcase-inline-highlight"
        >
          {sentence.slice(match.start, match.end)}
          <span className="showcase-inline-footnotes">
            <button
              type="button"
              className="showcase-inline-footnote"
              onClick={() => onFeatureClick(match.feature.id)}
              title={`${match.feature.id} ${match.feature.title}`}
            >
              <sup>{match.feature.id}</sup>
            </button>
          </span>
        </span>
      );

      cursor = match.end;
    });

    if (cursor < sentence.length) {
      content.push(sentence.slice(cursor));
    }

    return content;
  });
}

function usePrismTheme() {
  useEffect(() => {
    const applyTheme = () => {
      const existing = document.getElementById('showcase-prism-theme');
      if (existing) existing.remove();

      const link = document.createElement('link');
      link.id = 'showcase-prism-theme';
      link.rel = 'stylesheet';
      link.href =
        document.documentElement.dataset.theme === 'dark'
          ? '/prism-one-dark.css'
          : '/prism-one-light.css';
      document.head.appendChild(link);
    };

    applyTheme();
    const observer = new MutationObserver(() => applyTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      observer.disconnect();
      document.getElementById('showcase-prism-theme')?.remove();
    };
  }, []);
}

function MarkdownPaper({ markdown, onFeatureClick }) {
  const containerRef = useRef(null);
  const currentChapterRef = useRef(null);

  useDeferredPrismHighlight(containerRef, [markdown]);

  const components = useMemo(() => {
    const renderHeading = (level) => {
      const HeadingTag = `h${level}`;

      return ({ children, className, ...props }) => {
        const headingText = flattenText(children);
        const chapter = chapterFeatureIndex[normalizeText(headingText)];
        currentChapterRef.current = chapter || null;
        const mergedClassName = ['showcase-heading', className].filter(Boolean).join(' ');

        return (
          <HeadingTag className={mergedClassName} {...props}>
            <span className="showcase-heading__text">{children}</span>
          </HeadingTag>
        );
      };
    };

    return {
      h1: renderHeading(1),
      h2: renderHeading(2),
      h3: renderHeading(3),
      h4: renderHeading(4),
      h5: renderHeading(5),
      h6: renderHeading(6),
      a: ({ href, children, ...props }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      ),
      table: ({ children, ...props }) => (
        <div className="showcase-markdown__table-wrap">
          <table {...props}>{children}</table>
        </div>
      ),
      p: ({ children, ...props }) => {
        const paragraphText = flattenText(children);
        const chapter = currentChapterRef.current;
        return (
          <p {...props}>
            {chapter?.features?.length
              ? renderInlineFootnotes(paragraphText, chapter, onFeatureClick)
              : children}
          </p>
        );
      },
      li: ({ children, ...props }) => {
        const itemText = flattenText(children);
        const chapter = currentChapterRef.current;
        return (
          <li {...props}>
            {chapter?.features?.length
              ? renderInlineFootnotes(itemText, chapter, onFeatureClick)
              : children}
          </li>
        );
      },
      code: ({ className, children, ...props }) => (
        <code className={className || 'language-markdown'} {...props}>
          {children}
        </code>
      ),
    };
  }, [onFeatureClick]);

  return (
    <div ref={containerRef} className="md-preview showcase-markdown">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function FeatureModal({ feature, open, onCancel }) {
  const [activeFileKey, setActiveFileKey] = useState('');
  const [activeSnippetKey, setActiveSnippetKey] = useState('');
  const codePanelRef = useRef(null);

  useEffect(() => {
    if (!feature?.files?.length) {
      setActiveFileKey('');
      setActiveSnippetKey('');
      return;
    }

    const firstFile = feature.files[0];
    setActiveFileKey(firstFile.key);
    setActiveSnippetKey(firstFile.snippets[0]?.key || '');
  }, [feature]);

  const activeFile = useMemo(
    () => feature?.files?.find((item) => item.key === activeFileKey) || feature?.files?.[0] || null,
    [activeFileKey, feature]
  );

  const activeSnippet = useMemo(
    () =>
      activeFile?.snippets?.find((item) => item.key === activeSnippetKey)
      || activeFile?.snippets?.[0]
      || null,
    [activeFile, activeSnippetKey]
  );

  const treeData = useMemo(() => buildTreeData(feature?.files || []), [feature]);
  const selectedTreeKeys = activeFile ? [`file:${activeFile.key}`] : [];
  const paperBasis = feature?.paperBasisNormalized || [];
  const prismLanguage = normalizePrismLanguage(activeSnippet?.language || activeFile?.language);

  useDeferredPrismHighlight(codePanelRef, [open, activeFileKey, activeSnippetKey, prismLanguage]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width="min(1480px, calc(100vw - 24px))"
      className="showcase-modal"
      style={{ top: 16, paddingBottom: 0, margin: '0 auto' }}
      destroyOnHidden
      title={null}
    >
      {feature ? (
        <div className="showcase-modal__shell">
          <header className="showcase-modal__header">
            <div className="showcase-modal__title-block">
              <Space size={10} wrap>
                <Tag color="blue">{feature.id}</Tag>
                {feature.group?.name ? <Tag bordered={false}>{feature.group.name}</Tag> : null}
                <Tag bordered={false}>{feature.files.length} 个关联文件</Tag>
              </Space>
              <h2>{feature.title}</h2>
              <p>{feature.overview || feature.summary}</p>
            </div>
          </header>

          <div className="showcase-modal__content">
            <aside className="showcase-modal__sidebar">
              <div className="showcase-modal__sidebar-head">
                <div className="showcase-panel__title">
                  <BranchesOutlined />
                  <span>代码树</span>
                </div>
              </div>
              <div className="showcase-modal__tree-wrap">
                {treeData.length ? (
                  <Tree
                    blockNode
                    treeData={treeData}
                    selectedKeys={selectedTreeKeys}
                    defaultExpandAll
                    titleRender={(node) => (
                      <span className={`showcase-tree-node showcase-tree-node--${node.nodeType || 'file'}`}>
                        <span className="showcase-tree-node__icon">
                          {node.nodeType === 'dir' ? <FolderOpenOutlined /> : <FileOutlined />}
                        </span>
                        <span className="showcase-tree-node__label">{node.title}</span>
                      </span>
                    )}
                    onSelect={(keys) => {
                      const key = String(keys[0] || '');
                      if (!key.startsWith('file:')) return;
                      const nextFileKey = key.replace('file:', '');
                      const nextFile = feature.files.find((item) => item.key === nextFileKey);
                      setActiveFileKey(nextFileKey);
                      setActiveSnippetKey(nextFile?.snippets?.[0]?.key || '');
                    }}
                  />
                ) : (
                  <Empty description="暂无代码树" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            </aside>

            <section className="showcase-modal__main">
              {activeFile ? (
                <>
                  <div className="showcase-code-header">
                    <div className="showcase-code-header__main">
                      <div className="showcase-panel__title">
                        <CodeOutlined />
                        <span>真实片段</span>
                      </div>
                      <div className="showcase-code-header__tags">
                        {paperBasis.length ? (
                          paperBasis.map((item) => (
                            <Tag key={`${feature.id}-${item.key || item.label}`}>{item.label || item.title || item.key}</Tag>
                          ))
                        ) : (
                          <Tag>{feature.paperBasis?.join('、') || '未标注'}</Tag>
                        )}
                        <Tag>{activeFile.path}</Tag>
                        {activeSnippet?.language ? <Tag>{activeSnippet.language}</Tag> : null}
                        {formatLineRange(activeSnippet) ? <Tag>{formatLineRange(activeSnippet)}</Tag> : null}
                      </div>
                      {(activeSnippet?.note || activeFile.summary) ? (
                        <p>{activeSnippet?.note || activeFile.summary}</p>
                      ) : null}
                    </div>
                  </div>

                  {activeFile.snippets.length > 1 ? (
                    <Segmented
                      block
                      className="showcase-snippet-switcher"
                      value={activeSnippet?.key}
                      options={activeFile.snippets.map((snippet) => ({
                        label: snippet.title,
                        value: snippet.key,
                      }))}
                      onChange={(value) => setActiveSnippetKey(String(value))}
                    />
                  ) : null}

                  {activeSnippet ? (
                    <div ref={codePanelRef} className="showcase-code-panel">
                      <pre>
                        <code className={`language-${prismLanguage}`}>
                          {activeSnippet.code}
                        </code>
                      </pre>
                    </div>
                  ) : (
                    <Empty description="暂无片段" />
                  )}
                </>
              ) : (
                <Empty description="暂无文件映射" />
              )}
            </section>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function ShowcaseApp() {
  const theme = useShowcaseTheme((state) => state.theme);
  const toggleTheme = useShowcaseTheme((state) => state.toggleTheme);
  const [activeFeatureId, setActiveFeatureId] = useState(null);

  usePrismTheme();

  const activeFeature = activeFeatureId ? featureIndex[activeFeatureId] || null : null;

  return (
    <div className="showcase-app">
      <header className="showcase-app__header">
        <div className="showcase-brand">
          <div className="showcase-brand__badge">MDE</div>
          <div>
            <h1>{showcaseMeta.title}</h1>
            <p>{showcaseMeta.subtitle}</p>
          </div>
        </div>

        <Space size={12} wrap>
          <Button
            icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '切换浅色' : '切换深色'}
          </Button>
        </Space>
      </header>

      <main className="showcase-app__body">
        <section className="showcase-reader">
          <div className="showcase-reader__paper">
            <MarkdownPaper markdown={paperMarkdown} onFeatureClick={setActiveFeatureId} />
          </div>
        </section>
      </main>

      <FeatureModal
        feature={activeFeature}
        open={Boolean(activeFeature)}
        onCancel={() => setActiveFeatureId(null)}
      />
    </div>
  );
}
