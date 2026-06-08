import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const showcaseDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(showcaseDir, "..");

const PAPER_SOURCE_CANDIDATES = [
  path.join(repoRoot, "毕业设计AI稿.md"),
  path.join(repoRoot, "test.txt"),
];
const featureIndexPath = path.join(repoRoot, "docs", "论文析出", "功能技术文档.md");
const featureDocsDir = path.join(repoRoot, "docs", "论文析出", "按功能拆分");
const outputDir = path.join(showcaseDir, "src", "data");
const paperOutputPath = path.join(outputDir, "paper.md");
const outputPath = path.join(outputDir, "showcase.generated.json");

const GROUP_KEYWORDS = [
  { key: "module", name: "一级功能模块", match: "一级功能模块" },
  { key: "editing", name: "编辑与渲染", match: "编辑与渲染相关功能" },
  { key: "syntax", name: "Markdown 扩展语法", match: "Markdown 扩展语法与渲染能力" },
  { key: "file", name: "文件管理", match: "文件管理与内容检索功能" },
  { key: "search", name: "内容检索", match: "内容检索能力" },
  { key: "sync", name: "认证同步与协同", match: "认证、同步与协同功能" },
  { key: "settings", name: "设置与个性化", match: "设置与个性化功能" },
  { key: "platform", name: "跨平台适配", match: "跨平台适配功能" },
];

const MAX_SNIPPET_LINES = 60;

const GENERIC_TERMS = new Set([
  "state",
  "mode",
  "rules",
  "rendering",
  "listener",
  "split",
  "layout",
  "support",
  "cursor",
  "task",
  "list",
  "mobile",
  "fullscreen",
  "outline",
  "content",
  "table",
  "preview",
  "editor",
]);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function toRootRelative(absPath) {
  return toPosix(path.relative(repoRoot, absPath));
}

function toShowcaseRelative(absPath) {
  return toPosix(path.relative(showcaseDir, absPath));
}

function normalizeWhitespace(text) {
  return text.replace(/\r/g, "").trim();
}

function stripCodeTicks(text) {
  return text.replace(/`/g, "").trim();
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

function resolveExistingPath(candidates, label) {
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (resolved) {
    return resolved;
  }

  const visibleCandidates = candidates.map((candidate) => toPosix(candidate)).join(", ");
  throw new Error(`Unable to locate ${label}. Checked: ${visibleCandidates}`);
}

function resolvePaperSourcePath() {
  const envSource = process.env.SHOWCASE_PAPER_SOURCE?.trim();
  const candidates = [];

  if (envSource) {
    candidates.push(path.resolve(showcaseDir, envSource));
  }

  candidates.push(...PAPER_SOURCE_CANDIDATES);
  return resolveExistingPath(uniqueList(candidates), "paper source");
}

function getFileLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".js": "javascript",
    ".jsx": "jsx",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".scss": "scss",
    ".kt": "kotlin",
    ".rs": "rust",
    ".json": "json",
    ".md": "markdown",
  };
  return map[ext] || "text";
}

function normalizePaperBasisEntry(entry) {
  const cleaned = stripCodeTicks(entry)
    .replace(/^[-*]\s*/, "")
    .replace(/[；;]+$/g, "")
    .trim();
  const numericMatch = cleaned.match(/^(\d+(?:\.\d+)*)(?:\s+(.+))?$/);
  if (numericMatch) {
    return {
      key: numericMatch[1],
      sectionId: numericMatch[1],
      title: (numericMatch[2] || "").trim(),
      label: cleaned,
      kind: "section",
    };
  }
  return {
    key: cleaned,
    sectionId: null,
    title: cleaned,
    label: cleaned,
    kind: "named",
  };
}

function findGroupByHeading(heading) {
  return (
    GROUP_KEYWORDS.find((item) => heading.includes(item.match)) || {
      key: "other",
      name: heading,
      match: heading,
    }
  );
}

function parseFeatureIndex(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const features = new Map();
  let currentGroup = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      currentGroup = findGroupByHeading(headingMatch[1].trim());
      continue;
    }

    if (!line.includes("| F-")) {
      continue;
    }

    const parts = line
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 4) {
      continue;
    }

    const id = parts[0];
    if (!/^F-\d{2}$/.test(id)) {
      continue;
    }

    const title = parts[1];
    const summary = parts[2];
    const paperBasis = parts[3]
      .split(/[；]/)
      .map((item) => item.trim())
      .filter(Boolean);

    features.set(id, {
      id,
      title,
      summary,
      paperBasis,
      group: currentGroup
        ? { key: currentGroup.key, name: currentGroup.name }
        : { key: "other", name: "未分组" },
    });
  }

  return features;
}

function resolveDocLink(featureDocPath, href) {
  const normalizedHref = href.replace(/^\.\//, "");
  return path.resolve(path.dirname(featureDocPath), normalizedHref);
}

function parseFeatureDoc(featureDocPath) {
  const raw = readText(featureDocPath).replace(/\r/g, "");
  const lines = raw.split("\n");
  const title = (lines.find((line) => line.startsWith("# ")) || "")
    .replace(/^#\s+/, "")
    .trim();

  const sections = {};
  let currentSection = null;
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections[currentSection] = [];
      continue;
    }
    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  const overview = normalizeWhitespace((sections["功能是什么"] || []).join("\n"));
  const basis = (sections["论文里是怎么定义这个功能的"] || [])
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const notes = (sections["协作建议"] || [])
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const readingGuide = (sections["关键代码怎么读"] || [])
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);

  let parentFeatureId = null;
  const childFeatureIds = [];
  for (const note of notes) {
    const parentMatch = note.match(/\(.*?(F-\d{2}).*?\)/);
    if (note.includes("上级模块") && parentMatch) {
      parentFeatureId = parentMatch[1];
    }
    const childMatch = note.match(/`(F-\d{2})`/);
    if (childMatch) {
      childFeatureIds.push(childMatch[1]);
    }
  }

  const relatedFiles = [];
  const codeLines = sections["对应代码在哪"] || [];
  for (let index = 0; index < codeLines.length; index += 1) {
    const line = codeLines[index];
    const fileMatch = line.match(/^- 代码位置：\[(.+?)\]\((.+?)\)$/);
    if (!fileMatch) {
      continue;
    }

    const fileName = fileMatch[1].trim();
    const linkPath = fileMatch[2].trim();
    const symbolLine = (codeLines[index + 1] || "").trim();
    const purposeLine = (codeLines[index + 2] || "").trim();
    const symbol = stripCodeTicks(symbolLine.replace(/^符号：/, "").trim());
    const purpose = purposeLine.replace(/^作用：/, "").trim();
    const absPath = resolveDocLink(featureDocPath, linkPath);

    relatedFiles.push({
      fileName,
      path: toRootRelative(absPath),
      absolutePath: absPath,
      symbol,
      explanation: purpose,
      language: getFileLanguage(absPath),
    });
  }

  return {
    title,
    overview,
    paperBasis: basis,
    readingGuide,
    notes,
    parentFeatureId,
    childFeatureIds: uniqueList(childFeatureIds).filter((id) => id !== parentFeatureId),
    relatedFiles,
    docPath: toRootRelative(featureDocPath),
  };
}

function getSearchTerms(symbol, explanation, filePath) {
  const terms = [];
  const pushTerm = (value) => {
    const trimmed = value && value.trim();
    if (!trimmed || trimmed.length < 2) {
      return;
    }
    terms.push(trimmed);
  };

  pushTerm(symbol);
  symbol
    .split(/[\/,]/)
    .map((item) => stripCodeTicks(item))
    .forEach(pushTerm);

  symbol
    .split(/[\s/(),]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((term) => {
      if (!GENERIC_TERMS.has(term.toLowerCase())) {
        pushTerm(term);
      }
    });

  explanation
    .match(/[A-Za-z_][A-Za-z0-9_]{2,}/g)
    ?.forEach((term) => {
      if (!GENERIC_TERMS.has(term.toLowerCase())) {
        pushTerm(term);
      }
    });

  pushTerm(path.basename(filePath, path.extname(filePath)));
  return uniqueList(terms);
}

function findAnchorLine(lines, terms) {
  const search = (matcher) => {
    for (const term of terms) {
      const index = lines.findIndex((line) => matcher(line, term));
      if (index >= 0) {
        return { lineIndex: index, matchedTerm: term };
      }
    }
    return null;
  };

  const isImplementationLine = (line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("import ") && !trimmed.startsWith("//") && !trimmed.startsWith("*");
  };

  const nonImportExact = search((line, term) => isImplementationLine(line) && line.includes(term));
  if (nonImportExact) {
    return nonImportExact;
  }

  for (const term of terms) {
    const exactIndex = lines.findIndex((line) => line.includes(term));
    if (exactIndex >= 0) {
      return { lineIndex: exactIndex, matchedTerm: term };
    }
  }

  const nonImportFuzzy = search(
    (line, term) => isImplementationLine(line) && line.toLowerCase().includes(term.toLowerCase()),
  );
  if (nonImportFuzzy) {
    return nonImportFuzzy;
  }

  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    const fuzzyIndex = lines.findIndex((line) => line.toLowerCase().includes(lowerTerm));
    if (fuzzyIndex >= 0) {
      return { lineIndex: fuzzyIndex, matchedTerm: term };
    }
  }

  return null;
}

function findDeclarationStart(lines, anchorLine) {
  const declarationPatterns = [
    /^\s*export\s+default\s+function\b/,
    /^\s*export\s+function\b/,
    /^\s*function\b/,
    /^\s*export\s+const\b/,
    /^\s*const\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?(?:\(|\{)?/,
    /^\s*class\b/,
    /^\s*export\s+class\b/,
    /^\s*async\s+function\b/,
    /^\s*pub\s+fn\b/,
    /^\s*fn\b/,
    /^\s*fun\b/,
    /^\s*class\b/,
    /^\s*@media\b/,
    /^\s*[.#]?[A-Za-z0-9_:-][^{]*\{\s*$/,
  ];

  for (let index = anchorLine; index >= Math.max(0, anchorLine - 40); index -= 1) {
    if (declarationPatterns.some((pattern) => pattern.test(lines[index]))) {
      return index;
    }
  }

  for (let index = anchorLine; index >= Math.max(0, anchorLine - 20); index -= 1) {
    if (!lines[index].trim()) {
      return Math.min(lines.length - 1, index + 1);
    }
  }

  return Math.max(0, anchorLine - 5);
}

function extractBalancedBlock(lines, startIndex, fallbackAnchor) {
  let endIndex = Math.min(lines.length - 1, startIndex + 24);
  let braceCount = 0;
  let seenBrace = false;
  const maxEnd = Math.min(lines.length, startIndex + MAX_SNIPPET_LINES);

  for (let index = startIndex; index < maxEnd; index += 1) {
    const line = lines[index];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (opens > 0) {
      seenBrace = true;
    }
    braceCount += opens - closes;
    endIndex = index;

    if (seenBrace && braceCount <= 0 && index > fallbackAnchor) {
      break;
    }

    if (!seenBrace && index > fallbackAnchor && !line.trim()) {
      break;
    }
  }

  return endIndex;
}

function fallbackAnchorByExtension(lines, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".scss") {
    return lines.findIndex((line) => /^\s*@media\b/.test(line) || /^\s*[.#]?[A-Za-z0-9_:-][^{]*\{\s*$/.test(line));
  }
  if (ext === ".json") {
    return 0;
  }
  return lines.findIndex((line) =>
    /^\s*(export\s+default\s+function|export\s+function|function|export\s+const|const\s+[A-Za-z0-9_$]+\s*=|class|pub\s+fn|fn|fun)\b/.test(
      line,
    ),
  );
}

function extractSnippet(absPath, symbol, explanation) {
  if (!fs.existsSync(absPath)) {
    return {
      symbol,
      code: "",
      explanation,
      lineStart: null,
      lineEnd: null,
      matchType: "missing",
    };
  }

  const raw = readText(absPath).replace(/\r/g, "");
  const lines = raw.split("\n");
  const terms = getSearchTerms(symbol, explanation, absPath);
  const anchor = findAnchorLine(lines, terms);
  const fallbackIndex = fallbackAnchorByExtension(lines, absPath);
  const anchorLine = anchor ? anchor.lineIndex : fallbackIndex >= 0 ? fallbackIndex : 0;
  const startIndex = findDeclarationStart(lines, anchorLine);
  const endIndex = extractBalancedBlock(lines, startIndex, anchorLine);
  const snippetLines = lines.slice(startIndex, endIndex + 1);

  return {
    symbol,
    code: snippetLines.join("\n").trim(),
    explanation,
    lineStart: startIndex + 1,
    lineEnd: endIndex + 1,
    matchType: anchor ? "symbol" : "fallback",
    matchedTerm: anchor?.matchedTerm || null,
  };
}

function parsePaperSections(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const sections = [];
  let inToc = false;
  let capturedAny = false;

  for (const line of lines) {
    if (line.includes("目  录")) {
      inToc = true;
      continue;
    }
    if (!inToc) {
      continue;
    }

    const tocMatch = line.match(/^(\d+(?:\.\d+)*)(?:\.)?\s*(.+?)\t+\d+$/);
    if (!tocMatch) {
      if (capturedAny && line.trim()) {
        break;
      }
      continue;
    }

    const sectionId = tocMatch[1].trim();
    const title = tocMatch[2].trim();
    capturedAny = true;
    sections.push({
      id: sectionId,
      title,
      level: sectionId.split(".").length,
      label: `${sectionId} ${title}`.trim(),
      anchor: `section-${sectionId.replace(/\./g, "-")}`,
    });
  }

  sections.unshift(
    { id: "abstract", title: "摘要", level: 1, label: "摘要", anchor: "section-abstract" },
    { id: "keywords", title: "关键词", level: 1, label: "关键词", anchor: "section-keywords" },
  );

  return sections;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[`*_~[\]()>#]/g, "")
    .replace(/[：:]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function isCatalogLine(line) {
  return /[\t ]\d+\s*$/.test(String(line || "").trim());
}

function buildSectionVariants(section) {
  const variants = new Set();
  const { id, title, label } = section || {};

  if (label) {
    variants.add(label);
    variants.add(label.replace(/\s+/g, ""));
  }

  if (id && title) {
    variants.add(`${id} ${title}`);
    variants.add(`${id}${title}`);
  }

  if (title) {
    variants.add(title);
  }

  return Array.from(variants).map((item) => normalizeText(item));
}

function convertPaperToMarkdown(source, sections) {
  const lines = String(source || "").replace(/\r/g, "").split("\n");
  const sectionVariants = sections.map((section) => buildSectionVariants(section));
  let sectionCursor = 0;
  let inCatalog = false;
  const output = [];

  const findMatchedSection = (line) => {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine) {
      return null;
    }

    for (let offset = 0; offset < 4; offset += 1) {
      const section = sections[sectionCursor + offset];
      if (!section) {
        break;
      }

      if (sectionVariants[sectionCursor + offset].includes(normalizedLine)) {
        sectionCursor += offset + 1;
        return section;
      }
    }

    return null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, " ").replace(/\s+$/g, "");
    const trimmed = line.trim();
    const normalized = normalizeText(trimmed);

    if (normalized === "目录") {
      inCatalog = true;
      output.push("# 目录");
      output.push("");
      continue;
    }

    const shouldTryMatch = !inCatalog || !isCatalogLine(trimmed);
    const matchedSection = shouldTryMatch ? findMatchedSection(trimmed) : null;

    if (matchedSection) {
      inCatalog = false;
      output.push(`${"#".repeat(Math.max(1, Math.min(matchedSection.level || 1, 6)))} ${matchedSection.label || matchedSection.title}`);
      output.push("");
      continue;
    }

    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function buildPaperBasisMap(features, paperSections) {
  const sectionLookup = new Map(paperSections.map((section) => [section.id, section]));
  const basisMap = new Map();

  for (const feature of features) {
    for (const entry of feature.paperBasisNormalized) {
      const key = entry.key;
      if (!basisMap.has(key)) {
        const sectionMeta = entry.sectionId ? sectionLookup.get(entry.sectionId) : null;
        basisMap.set(key, {
          key,
          sectionId: entry.sectionId,
          title: entry.title || sectionMeta?.title || entry.label,
          label: sectionMeta ? sectionMeta.label : entry.label,
          featureIds: [],
        });
      }
      basisMap.get(key).featureIds.push(feature.id);
    }
  }

  return [...basisMap.values()]
    .map((item) => ({
      ...item,
      featureIds: uniqueList(item.featureIds).sort(),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN-u-kn-true"));
}

function sortFeatures(features) {
  return [...features].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function main() {
  ensureDir(outputDir);

  const paperSourcePath = resolvePaperSourcePath();
  const paperRawText = readText(paperSourcePath);
  const paperSections = parsePaperSections(paperRawText);
  const paperMarkdown = convertPaperToMarkdown(paperRawText, paperSections);
  const paperSectionLookup = new Map(paperSections.map((section) => [section.id, section]));
  const featureIndexMarkdown = readText(featureIndexPath);
  const featureIndexMap = parseFeatureIndex(featureIndexMarkdown);

  const featureDocPaths = fs
    .readdirSync(featureDocsDir)
    .filter((fileName) => /^F-\d{2}-.+\.md$/.test(fileName))
    .map((fileName) => path.join(featureDocsDir, fileName))
    .sort((left, right) => left.localeCompare(right, "zh-CN-u-kn-true"));

  const features = featureDocPaths.map((featureDocPath) => {
    const idMatch = path.basename(featureDocPath).match(/^(F-\d{2})-/);
    const id = idMatch?.[1];
    const indexMeta = featureIndexMap.get(id) || null;
    const docMeta = parseFeatureDoc(featureDocPath);

    const relatedFiles = docMeta.relatedFiles.map((fileItem) => ({
      path: fileItem.path,
      symbol: fileItem.symbol,
      explanation: fileItem.explanation,
      language: fileItem.language,
      snippets: [extractSnippet(fileItem.absolutePath, fileItem.symbol, fileItem.explanation)],
    }));

    const paperBasis = docMeta.paperBasis.length ? docMeta.paperBasis : indexMeta?.paperBasis || [];
    const normalizedBasis = paperBasis.map((entry) => {
      const normalized = normalizePaperBasisEntry(entry);
      const sectionMeta = normalized.sectionId ? paperSectionLookup.get(normalized.sectionId) : null;
      if (sectionMeta) {
        const shouldUseSectionLabel =
          normalized.label === normalized.sectionId || normalized.label === stripCodeTicks(entry);
        return {
          ...normalized,
          title: normalized.title || sectionMeta.title,
          label: shouldUseSectionLabel ? sectionMeta.label : normalized.label,
        };
      }
      return normalized;
    });

    return {
      id,
      title: indexMeta?.title || docMeta.title,
      group: indexMeta?.group || { key: "other", name: "未分组" },
      summary: indexMeta?.summary || docMeta.overview,
      overview: docMeta.overview,
      paperBasis,
      paperBasisNormalized: normalizedBasis,
      docPath: docMeta.docPath,
      parentFeatureId: docMeta.parentFeatureId,
      childFeatureIds: docMeta.childFeatureIds,
      readingGuide: docMeta.readingGuide,
      collaborationNotes: docMeta.notes,
      relatedFiles,
    };
  });

  const chapterFeatureMap = buildPaperBasisMap(features, paperSections);
  const featureGroups = uniqueList(features.map((feature) => feature.group.key)).map((groupKey) => {
    const groupMeta = features.find((feature) => feature.group.key === groupKey)?.group || {
      key: groupKey,
      name: groupKey,
    };
    return {
      key: groupMeta.key,
      name: groupMeta.name,
      featureIds: sortFeatures(features.filter((feature) => feature.group.key === groupKey)).map((feature) => feature.id),
    };
  });

  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      generator: "showcase/scripts/generate-showcase-data.mjs",
      featureCount: features.length,
      paperSourcePath: toRootRelative(paperSourcePath),
      paperSourceCandidates: PAPER_SOURCE_CANDIDATES.map((candidate) => toRootRelative(candidate)),
      featureIndexPath: toRootRelative(featureIndexPath),
      featureDocsDir: toRootRelative(featureDocsDir),
      outputPath: toShowcaseRelative(outputPath),
    },
    paper: {
      title: "基于Tauri的Markdown编辑器",
      sourcePath: toRootRelative(paperSourcePath),
      rawText: paperRawText,
      markdown: paperMarkdown,
      sections: paperSections,
      chapterFeatureMap,
    },
    featureGroups,
    features: sortFeatures(features).map((feature) => ({
      ...feature,
      paperBasisNormalized: feature.paperBasisNormalized.map(({ key, sectionId, title, label, kind }) => ({
        key,
        sectionId,
        title,
        label,
        kind,
      })),
    })),
  };

  fs.writeFileSync(paperOutputPath, `${paperRawText}\n`, "utf8");
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(
    `Generated ${toShowcaseRelative(outputPath)} and ${toShowcaseRelative(paperOutputPath)} with ${features.length} features from ${toRootRelative(paperSourcePath)}.`,
  );
}

main();
