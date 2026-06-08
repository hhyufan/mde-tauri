import thesisSourceMarkdown from '../../../毕业设计AI稿.md?raw';
import paperMarkdownFallback from './paper.md?raw';
import showcaseData from './showcase.generated.json';

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

function isCatalogLine(line) {
  return /[\t ]\d+\s*$/.test(String(line || '').trim());
}

function buildSectionVariants(section) {
  const variants = new Set();
  const { id, title, label } = section || {};

  if (label) {
    variants.add(label);
    variants.add(label.replace(/\s+/g, ''));
  }
  if (id && title) {
    variants.add(`${id} ${title}`);
    variants.add(`${id}${title}`);
  }
  if (title) variants.add(title);

  return Array.from(variants).map((item) => normalizeText(item));
}

function convertPaperToMarkdown(source, sections) {
  const lines = String(source || '').replace(/\r/g, '').split('\n');
  const sectionVariants = sections.map((section) => buildSectionVariants(section));
  let sectionCursor = 0;
  let inCatalog = false;
  const output = [];

  const findMatchedSection = (line) => {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine) return null;

    for (let offset = 0; offset < 4; offset += 1) {
      const section = sections[sectionCursor + offset];
      if (!section) break;
      if (sectionVariants[sectionCursor + offset].includes(normalizedLine)) {
        sectionCursor += offset + 1;
        return section;
      }
    }

    return null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').replace(/\s+$/g, '');
    const trimmed = line.trim();
    const normalized = normalizeText(trimmed);

    if (normalized === '目录') {
      inCatalog = true;
      output.push('# 目录');
      output.push('');
      continue;
    }

    const shouldTryMatch = !inCatalog || !isCatalogLine(trimmed);
    const matchedSection = shouldTryMatch ? findMatchedSection(trimmed) : null;

    if (matchedSection) {
      inCatalog = false;
      output.push(`${'#'.repeat(Math.max(1, Math.min(matchedSection.level || 1, 6)))} ${matchedSection.label || matchedSection.title}`);
      output.push('');
      continue;
    }

    output.push(line);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

function stripCatalogSection(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const output = [];
  let skippingCatalog = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#\s*目录$/.test(trimmed)) {
      skippingCatalog = true;
      continue;
    }

    if (
      skippingCatalog
      && /^#\s+/.test(trimmed)
      && !/^#\s*目录$/.test(trimmed)
    ) {
      skippingCatalog = false;
    }

    if (!skippingCatalog) {
      output.push(line);
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildDisplayMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const summaryHeadingIndex = lines.findIndex((line) => /^#\s*摘要$/.test(line.trim()));
  const firstChapterIndex = lines.findIndex((line) => /^#\s*1(?:\s+|[.、])/.test(line.trim()));
  const acknowledgementIndex = lines.findIndex((line) => /^#\s*致谢$/.test(line.trim()));
  const referencesIndex = lines.findIndex((line) => /^#\s*参考文献$/.test(line.trim()));

  if (summaryHeadingIndex < 0) {
    return String(markdown || '').trim();
  }

  const bodyEndCandidates = [acknowledgementIndex, referencesIndex].filter((index) => index >= 0);
  const bodyEndIndex = bodyEndCandidates.length ? Math.min(...bodyEndCandidates) : lines.length;

  if (firstChapterIndex < 0 || firstChapterIndex <= summaryHeadingIndex) {
    return lines
      .slice(summaryHeadingIndex, bodyEndIndex)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  let abstractEndIndex = firstChapterIndex;
  for (let index = firstChapterIndex - 1; index >= summaryHeadingIndex; index -= 1) {
    const trimmed = lines[index].trim();
    if (/^>\s*(?:关键词|Key words)/i.test(trimmed)) {
      abstractEndIndex = index + 1;
      break;
    }
  }

  return [
    ...lines.slice(summaryHeadingIndex, abstractEndIndex),
    '',
    ...lines.slice(firstChapterIndex, bodyEndIndex),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isCorruptedCommentLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  if (!/^\/\*\*?|^\*|^\/\//.test(trimmed)) return false;
  return /\?{3,}|�{2,}/.test(trimmed);
}

function sanitizeSnippetCode(code) {
  const lines = String(code || '').split('\n');
  const sanitized = lines.filter((line) => !isCorruptedCommentLine(line));
  return sanitized.join('\n').replace(/^\s*\n+/, '').trimEnd();
}

function normalizeFeature(feature) {
  const files = Array.isArray(feature.relatedFiles)
    ? feature.relatedFiles.map((file, fileIndex) => {
        const fileKey = `${feature.id}:${file.path}:${fileIndex}`;
        const fileSnippets = Array.isArray(file.snippets) ? file.snippets : [];

        return {
          key: fileKey,
          path: file.path,
          symbol: file.symbol || basename(file.path),
          summary: file.explanation || '',
          language: file.language || 'text',
          snippets: fileSnippets.map((snippet, snippetIndex) => ({
            key: `${fileKey}:${snippet.symbol || snippetIndex}`,
            title: snippet.symbol || `${file.symbol || basename(file.path)} 片段 ${snippetIndex + 1}`,
            language: file.language || 'text',
            note: snippet.explanation || file.explanation || '',
            code: sanitizeSnippetCode(snippet.code || ''),
            lineStart: snippet.lineStart ?? null,
            lineEnd: snippet.lineEnd ?? null,
            symbol: snippet.symbol || file.symbol || '',
            matchType: snippet.matchType || '',
            matchedTerm: snippet.matchedTerm || '',
          })),
        };
      })
    : [];

  return {
    ...feature,
    files,
  };
}

const paperSections = Array.isArray(showcaseData.paper?.sections) ? showcaseData.paper.sections : [];
const rawFeatures = Array.isArray(showcaseData.features) ? showcaseData.features : [];
const paperRawText = thesisSourceMarkdown || showcaseData.paper?.rawText || '';
const generatedPaperMarkdown =
  convertPaperToMarkdown(paperRawText || paperMarkdownFallback, paperSections)
  || showcaseData.paper?.markdown
  || paperMarkdownFallback;
const paperMarkdownReaderText = buildDisplayMarkdown(stripCatalogSection(generatedPaperMarkdown));

export const showcaseMeta = {
  title: '论文代码展示端',
  subtitle: '基于《毕业设计AI稿》原文内容进行结构化展示，并在具体句子后插入可点击的 F 脚注与源码映射。',
  documentTitle: showcaseData.paper?.title || '基于Tauri的Markdown编辑器',
  documentSource: '毕业设计AI稿.md',
  featureDataSource: 'src/data/showcase.generated.json',
};

export const paperSourceText = paperRawText;
export const paperMarkdown = paperMarkdownReaderText;
export const paper = showcaseData.paper || {};
export const featureGroups = Array.isArray(showcaseData.featureGroups) ? showcaseData.featureGroups : [];
export const features = rawFeatures.map((feature) => normalizeFeature(feature));
export const featureIndex = Object.fromEntries(features.map((feature) => [feature.id, feature]));
export const featureCount = features.length;
export const featuredFeatureIds = ['F-10', 'F-40', 'F-56'].filter((id) => featureIndex[id]);
export const chapterFeatureMap = Array.isArray(showcaseData.paper?.chapterFeatureMap)
  ? showcaseData.paper.chapterFeatureMap
  : [];
export const chapterFeatureIndex = Object.fromEntries(
  chapterFeatureMap.flatMap((chapter) => {
    const entry = {
      ...chapter,
      features: (chapter.featureIds || []).map((id) => featureIndex[id]).filter(Boolean),
    };

    return [chapter.key, chapter.sectionId, chapter.label, chapter.title]
      .filter(Boolean)
      .map((key) => [normalizeText(key), entry]);
  })
);
