/**
 * Milkdown Markdown 编辑器模块。
 *
 * 该模块集中封装所见即所得编辑、只读预览增强、数学公式渲染、Mermaid 预览、
 * 代码块语言与预览面板、任务列表交互、图片资源补全，以及编辑器与外部缓冲区/
 * 自动保存链路之间的同步桥接逻辑，对上层暴露单一的 React 组件入口。
 */
import {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Editor, commandsCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import {
  commonmark,
  bulletListSchema,
  createCodeBlockCommand,
  emphasisSchema,
  imageSchema,
  insertHrCommand,
  insertImageCommand,
  listItemSchema,
  paragraphSchema,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  gfm,
  insertTableCommand,
  tableCellSchema,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableRowSchema,
  tableSchema,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block';
import { $ctx, $inputRule, $nodeSchema, $prose, $remark, getMarkdown, insert, replaceRange } from '@milkdown/kit/utils';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { findChildren } from '@milkdown/kit/prose';
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import katex from 'katex';
import remarkMath from 'remark-math';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { css, sCSS } from '@codemirror/legacy-modes/mode/css';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { python } from '@codemirror/legacy-modes/mode/python';
import { sql } from '@codemirror/legacy-modes/mode/sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { c, cpp, dart, java, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
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
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '@milkdown/kit/prose/tables/style/tables.css';
import 'katex/dist/katex.min.css';
import { useFileManager } from '@hooks/useFileManager';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import useToastStore from '@store/useToastStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import { setBuffer } from '@utils/editorBuffer';
import { hydrateMarkdownImages, parseMarkdownLineHint, resolveMarkdownLinkPath } from '@utils/markdownAssets';
import i18n from '@/i18n';
import MermaidRenderer from './MermaidRenderer';
import './markdown-preview.scss';

/**
 * 代码语言到展示名称的映射表。
 *
 * 用于统一代码块头部标签、语言选择器与预览模式中的语言文案展示。
 */
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

const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--md-code-keyword)' },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: 'var(--md-code-name)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--md-code-function)' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: 'var(--md-code-constant)' },
  { tag: [tags.definition(tags.name), tags.separator], color: 'var(--md-code-definition)' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: 'var(--md-code-type)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: 'var(--md-code-operator)' },
  { tag: [tags.meta, tags.comment], color: 'var(--md-code-comment)' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: '600', color: 'var(--md-code-heading)' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: 'var(--md-code-atom)' },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: 'var(--md-code-string)' },
  { tag: tags.invalid, color: 'var(--error)' },
]);

const codeMirrorTheme = CodeMirrorView.theme({
  '&': {
    color: 'var(--md-code-text)',
    backgroundColor: 'transparent',
    fontFamily: 'var(--font-editor)',
    fontSize: '0.9em',
  },
  '.cm-content': {
    padding: '16px',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-editor)',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
  },
});

const codeBlockExtensions = [
  codeMirrorTheme,
  CodeMirrorView.lineWrapping,
  syntaxHighlighting(codeHighlightStyle),
];

const mathInlineType = 'math_inline';
const mathBlockType = 'math_block';
const mathSourceInlineType = 'math_source_inline';
const mathSourceBlockType = 'math_source_block';
const imageSourceInlineType = 'image_source_inline';
const tableSourceBlockType = 'table_source_block';
const mathSourceEditMeta = 'mdeMathSourceEdit';
const markdownSourceEditMeta = 'mdeMarkdownSourceEdit';
const remarkMathPlugin = $remark('remarkMath', () => remarkMath);
const katexOptionsCtx = $ctx({
  throwOnError: false,
  strict: false,
}, 'katexOptions');

const mathInlineSchema = $nodeSchema(mathInlineType, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  isolating: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [{
    tag: `span[data-type="${mathInlineType}"]`,
    getAttrs: (dom) => ({ value: dom.dataset.value || dom.textContent || '' }),
  }],
  toDOM: (node) => [
    'span',
    {
      'data-type': mathInlineType,
      'data-value': node.attrs.value,
      class: 'md-preview__math md-preview__math--inline',
      contenteditable: 'false',
    },
    node.attrs.value,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === mathInlineType,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs.value);
    },
  },
}));

const mathBlockSchema = $nodeSchema(mathBlockType, () => ({
  group: 'block',
  marks: '',
  defining: true,
  atom: true,
  isolating: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [{
    tag: `div[data-type="${mathBlockType}"]`,
    preserveWhitespace: 'full',
    getAttrs: (dom) => ({ value: dom.dataset.value || dom.textContent || '' }),
  }],
  toDOM: (node) => [
    'div',
    {
      'data-type': mathBlockType,
      'data-value': node.attrs.value,
      class: 'md-preview__math md-preview__math--block',
      contenteditable: 'false',
    },
    node.attrs.value,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === mathBlockType,
    runner: (state, node) => {
      state.addNode('math', undefined, node.attrs.value);
    },
  },
}));

const mathSourceInlineSchema = $nodeSchema(mathSourceInlineType, () => ({
  group: 'inline',
  content: 'text*',
  inline: true,
  isolating: true,
  marks: '',
  parseDOM: [{
    tag: `span[data-type="${mathSourceInlineType}"]`,
  }],
  toDOM: () => [
    'span',
    {
      'data-type': mathSourceInlineType,
      class: 'md-preview__math-source md-preview__math-source--inline',
    },
    0,
  ],
  toMarkdown: {
    match: (node) => node.type.name === mathSourceInlineType,
    runner: (state, node) => {
      state.addNode('html', undefined, node.textContent);
    },
  },
  parseMarkdown: {
    match: () => false,
    runner: () => {},
  },
}));

const mathSourceBlockSchema = $nodeSchema(mathSourceBlockType, () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,
  code: true,
  parseDOM: [{
    tag: `div[data-type="${mathSourceBlockType}"]`,
    preserveWhitespace: 'full',
  }],
  toDOM: () => [
    'div',
    {
      'data-type': mathSourceBlockType,
      class: 'md-preview__math-source md-preview__math-source--block',
    },
    0,
  ],
  toMarkdown: {
    match: (node) => node.type.name === mathSourceBlockType,
    runner: (state, node) => {
      state.addNode('html', undefined, node.textContent);
    },
  },
  parseMarkdown: {
    match: () => false,
    runner: () => {},
  },
}));

/**
 * 为原子渲染节点生成对应的“源码态”节点 schema。
 *
 * @param {string} name ProseMirror 节点名称。
 * @param {{inline: boolean}} options 节点布局选项。
 * @returns {any} Milkdown 节点 schema 定义。
 */
function rawSourceNodeSchema(name, { inline }) {
  return $nodeSchema(name, () => ({
    group: inline ? 'inline' : 'block',
    content: 'text*',
    inline,
    marks: '',
    defining: !inline,
    isolating: true,
    code: !inline,
    parseDOM: [{
      tag: `${inline ? 'span' : 'div'}[data-type="${name}"]`,
      preserveWhitespace: inline ? undefined : 'full',
    }],
    toDOM: () => [
      inline ? 'span' : 'div',
      {
        'data-type': name,
        class: `md-preview__raw-source md-preview__raw-source--${inline ? 'inline' : 'block'}`,
      },
      0,
    ],
    toMarkdown: {
      match: (node) => node.type.name === name,
      runner: (state, node) => {
        state.addNode('html', undefined, node.textContent);
      },
    },
    parseMarkdown: {
      match: () => false,
      runner: () => {},
    },
  }));
}

const imageSourceInlineSchema = rawSourceNodeSchema(imageSourceInlineType, { inline: true });
const tableSourceBlockSchema = rawSourceNodeSchema(tableSourceBlockType, { inline: false });

/**
 * 允许用户在已渲染态与源码态之间切换的 ProseMirror 插件。
 *
 * 对数学公式、图片和表格这类原子节点，Backspace/Delete 不直接删除整块，
 * 而是先回退到可编辑的 Markdown 源码表示，降低误删成本。
 */
/**
 * 转义 Markdown 图片标题中的双引号。
 *
 * @param {string} title 原始标题文本。
 * @returns {string} 可安全写回 Markdown 的标题文本。
 */
function escapeImageTitle(title) {
  return String(title || '').replace(/"/g, '\\"');
}

/**
 * 将图片节点序列化为 Markdown 源码片段。
 *
 * @param {any} node 图片节点。
 * @returns {string} 对应的 Markdown 图片语法。
 */
function imageToSource(node) {
  const alt = node.attrs.alt || '';
  const src = node.attrs.src || '';
  const title = node.attrs.title ? ` "${escapeImageTitle(node.attrs.title)}"` : '';
  return `![${alt}](${src}${title})`;
}

/**
 * 解析 Markdown 图片源码，提取图片属性。
 *
 * @param {string} source Markdown 图片源码。
 * @returns {{alt: string, src: string, title: string} | null} 解析结果。
 */
function parseImageSource(source) {
  const match = /^!\[([\s\S]*?)]\((\S*?)(?:\s+"([\s\S]*?)")?\)$/.exec(source);
  if (!match) return null;
  return {
    alt: match[1] || '',
    src: match[2] || '',
    title: match[3] || '',
  };
}

/**
 * 提取表格单元格的纯文本内容，并转义竖线字符。
 *
 * @param {any} cell 表格单元格节点。
 * @returns {string} 可写回 Markdown 表格的单元格文本。
 */
function tableCellText(cell) {
  return (cell.textContent || '').replace(/\|/g, '\\|').trim();
}

/**
 * 将表格节点序列化为 Markdown 表格源码。
 *
 * @param {any} node 表格节点。
 * @returns {string} Markdown 表格文本。
 */
function tableToSource(node) {
  const rows = [];
  node.forEach((row) => {
    const cells = [];
    row.forEach((cell) => {
      cells.push(tableCellText(cell));
    });
    rows.push(cells);
  });

  if (!rows.length) return '|  |\n| --- |';
  const header = rows[0] || [];
  const separator = header.map(() => '---');
  const body = rows.slice(1);
  return [header, separator, ...body]
    .map((cells) => `| ${cells.join(' | ')} |`)
    .join('\n');
}

/**
 * 按 Markdown 表格规则拆分一行单元格文本。
 *
 * @param {string} line 单行表格源码。
 * @returns {string[]} 拆分后的单元格数组。
 */
function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 判断一行文本是否为 Markdown 表格分隔线。
 *
 * @param {string} line 单行表格源码。
 * @returns {boolean} 是分隔线时返回 `true`。
 */
function isTableSeparator(line) {
  return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * 将 Markdown 表格源码解析回 ProseMirror 表格节点。
 *
 * @param {string} source 表格源码。
 * @param {any} schema 当前编辑器 schema。
 * @param {object} schemaTypes 表格相关节点类型集合。
 * @returns {any | null} 构造出的表格节点；解析失败时返回 `null`。
 */
function parseTableSource(source, schema, schemaTypes) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || !isTableSeparator(lines[1])) return null;

  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  if (!header.length) return null;

  const makeParagraph = (text) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const makeCell = (type, text) => type.create(null, makeParagraph(text));
  const headerRow = schemaTypes.tableHeaderRow.create(null, header.map((cell) => makeCell(schemaTypes.tableHeader, cell)));
  const bodyRows = rows.map((row) => schemaTypes.tableRow.create(null, header.map((_, index) => makeCell(schemaTypes.tableCell, row[index] || ''))));
  return schemaTypes.table.create(null, [headerRow, ...bodyRows]);
}

/**
 * 行内数学公式输入规则。
 *
 * 将 `$...$` 输入即时折叠为受控数学原子节点。
 */
const mathInlineInputRule = $inputRule(
  (ctx) => new InputRule(/(?:\$)([^$]+)(?:\$)$/, (state, match, start, end) => {
    const value = match[1] || '';
    if (!value) return null;
    return state.tr.replaceWith(start, end, mathInlineSchema.type(ctx).create({ value }));
  })
);

/**
 * 块级数学公式输入规则。
 *
 * 当用户输入 `$$` 起始标记时，将当前块切换为数学块节点。
 */
const mathBlockInputRule = $inputRule(
  (ctx) => new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
    const resolved = state.doc.resolve(start);
    return resolved.node(-1).canReplaceWith(
      resolved.index(-1),
      resolved.indexAfter(-1),
      mathBlockSchema.type(ctx)
    ) ? state.tr.delete(start, end).setBlockType(start, start, mathBlockSchema.type(ctx)) : null;
  })
);

/**
 * 数学公式、图片和表格的“渲染态/源码态”切换插件。
 *
 * 负责在删除键命中原子渲染节点时回退到可编辑源码表示，并在源码恢复成合法
 * 语法后自动重新折叠为渲染节点。
 */
const mathValueEditPlugin = $prose((ctx) => {
  const inlineType = mathInlineSchema.type(ctx);
  const blockType = mathBlockSchema.type(ctx);
  const inlineSourceType = mathSourceInlineSchema.type(ctx);
  const blockSourceType = mathSourceBlockSchema.type(ctx);
  const imageType = imageSchema.type(ctx);
  const imageSourceType = imageSourceInlineSchema.type(ctx);
  const tableType = tableSchema.type(ctx);
  const tableSourceType = tableSourceBlockSchema.type(ctx);
  const tableTypes = {
    table: tableType,
    tableHeaderRow: tableHeaderRowSchema.type(ctx),
    tableHeader: tableHeaderSchema.type(ctx),
    tableRow: tableRowSchema.type(ctx),
    tableCell: tableCellSchema.type(ctx),
  };
  const isMathNode = (node) => node?.type === inlineType || node?.type === blockType;
  const isEditableRenderedNode = (node) => isMathNode(node) || node?.type === imageType || node?.type === tableType;
  const isSourceNode = (node) => [
    inlineSourceType,
    blockSourceType,
    imageSourceType,
    tableSourceType,
  ].includes(node?.type);
  const deleteOne = (source, fromEnd) => (fromEnd ? source.slice(0, -1) : source.slice(1));

  const deleteInSourceNode = (view, event) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const { selection, schema } = view.state;
    if (!selection.empty) return false;

    const { $from } = selection;
    let depth = $from.depth;
    while (depth > 0 && !isSourceNode($from.node(depth))) depth -= 1;
    if (depth <= 0) return false;

    const node = $from.node(depth);
    const pos = $from.before(depth);
    const start = $from.start(depth);
    const offset = $from.pos - start;
    const source = node.textContent || '';
    if ((event.key === 'Backspace' && offset <= 0) || (event.key === 'Delete' && offset >= source.length)) return false;

    const nextOffset = event.key === 'Backspace' ? offset - 1 : offset;
    const nextSource = event.key === 'Backspace'
      ? `${source.slice(0, offset - 1)}${source.slice(offset)}`
      : `${source.slice(0, offset)}${source.slice(offset + 1)}`;
    const nextNode = node.type.create(node.attrs, nextSource ? schema.text(nextSource) : null, node.marks);
    const tr = view.state.tr
      .replaceWith(pos, pos + node.nodeSize, nextNode)
      .setMeta(markdownSourceEditMeta, true);
    tr.setSelection(TextSelection.create(tr.doc, start + nextOffset));
    view.dispatch(tr.scrollIntoView());
    event.preventDefault();
    return true;
  };

  const replaceWithRawSource = (view, pos, node, sourceType, source, fromEnd, cursorOffsetFromEnd = 0) => {
    const nextSource = deleteOne(source, fromEnd);
    if (!nextSource) {
      view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
      return true;
    }
    const replacement = sourceType.create(null, view.state.schema.text(nextSource));
    const tr = view.state.tr
      .replaceWith(pos, pos + node.nodeSize, replacement)
      .setMeta(markdownSourceEditMeta, true);
    const cursorPos = Math.min(pos + 1 + nextSource.length - cursorOffsetFromEnd, tr.doc.content.size);
    tr.setSelection(TextSelection.create(tr.doc, Math.max(pos + 1, cursorPos)));
    view.dispatch(tr.scrollIntoView());
    return true;
  };

  const replaceMathWithSource = (view, pos, node, fromEnd) => {
    const value = node.attrs.value || '';
    const nextValue = value
      ? (fromEnd ? value.slice(0, -1) : value.slice(1))
      : '';
    const isInline = node.type === inlineType;
    const source = isInline ? `$${nextValue}$` : `$$\n${nextValue}\n$$`;
    const schema = view.state.schema;
    const replacement = isInline
      ? inlineSourceType.create(null, schema.text(source))
      : blockSourceType.create(null, schema.text(source));
    const tr = view.state.tr
      .replaceWith(pos, pos + node.nodeSize, replacement)
      .setMeta(mathSourceEditMeta, true);
    const cursorPos = Math.min(pos + 1 + source.length - (isInline ? 1 : 3), tr.doc.content.size);
    tr.setSelection(TextSelection.create(tr.doc, Math.max(pos + 1, cursorPos)));
    view.dispatch(tr.scrollIntoView());
    return true;
  };

  const replaceRenderedWithSource = (view, pos, node, fromEnd) => {
    if (isMathNode(node)) return replaceMathWithSource(view, pos, node, fromEnd);
    if (node.type === imageType) return replaceWithRawSource(view, pos, node, imageSourceType, imageToSource(node), fromEnd, 0);
    if (node.type === tableType) return replaceWithRawSource(view, pos, node, tableSourceType, tableToSource(node), fromEnd, 0);
    return false;
  };

  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.some((tr) => tr.getMeta(mathSourceEditMeta) || tr.getMeta(markdownSourceEditMeta))) return null;
      let tr = null;

      newState.doc.descendants((node, pos) => {
        const source = node.textContent || '';
        if (node.type === inlineSourceType) {
          const match = /^\$([\s\S]*)\$$/.exec(source);
          if (!match) return;
          tr = (tr || newState.tr).replaceWith(pos, pos + node.nodeSize, inlineType.create({ value: match[1] || '' }));
          return;
        }

        if (node.type === blockSourceType) {
          const match = /^\$\$\n?([\s\S]*?)\n?\$\$$/.exec(source);
          if (!match) return;
          tr = (tr || newState.tr).replaceWith(pos, pos + node.nodeSize, blockType.create({ value: match[1] || '' }));
          return;
        }

        if (node.type === imageSourceType) {
          const attrs = parseImageSource(source);
          if (!attrs) return;
          tr = (tr || newState.tr).replaceWith(pos, pos + node.nodeSize, imageType.create(attrs));
          return;
        }

        if (node.type === tableSourceType) {
          const tableNode = parseTableSource(source, newState.schema, tableTypes);
          if (!tableNode) return;
          tr = (tr || newState.tr).replaceWith(pos, pos + node.nodeSize, tableNode);
        }
      });

      return tr;
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
        if (deleteInSourceNode(view, event)) return true;
        const { selection } = view.state;
        if (!selection.empty && !(selection instanceof NodeSelection)) return false;

        if (selection instanceof NodeSelection && isEditableRenderedNode(selection.node)) {
          event.preventDefault();
          return replaceRenderedWithSource(view, selection.from, selection.node, event.key === 'Backspace');
        }

        const { $from } = selection;
        const side = event.key === 'Backspace' ? $from.nodeBefore : $from.nodeAfter;
        const pos = event.key === 'Backspace'
          ? $from.pos - (side?.nodeSize || 0)
          : $from.pos;

        if (!isEditableRenderedNode(side)) return false;
        event.preventDefault();
        return replaceRenderedWithSource(view, pos, side, event.key === 'Backspace');
      },
    },
  });
});

/**
 * 任务列表复选框交互插件。
 *
 * 让只命中复选框热区的点击直接切换任务完成状态，而不是触发普通文本选区。
 */
const taskListCheckboxPlugin = $prose((ctx) => {
  const listItemType = listItemSchema.type(ctx);

  const closestTaskItem = (target) => {
    const element = target instanceof Element ? target : target?.parentElement;
    return element?.closest?.('li[data-item-type="task"]') || null;
  };

  const getTaskItem = (view, target) => {
    const item = closestTaskItem(target);
    if (!item || !view.dom.contains(item)) return null;

    try {
      const domPos = view.posAtDOM(item, 0);
      const $pos = view.state.doc.resolve(domPos);
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);
        if (node.type === listItemType && typeof node.attrs.checked === 'boolean') {
          return { item, node, pos: $pos.before(depth) };
        }
      }
    } catch {
      return null;
    }

    return null;
  };

  const isCheckboxHotspot = (item, event) => {
    const rect = item.getBoundingClientRect();
    const style = window.getComputedStyle(item);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return x >= 0
      && x <= Math.max(28, paddingLeft)
      && y >= 0
      && y <= Math.max(28, lineHeight);
  };

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!view.editable) return false;
          const task = getTaskItem(view, event.target);
          if (!task || !isCheckboxHotspot(task.item, event)) return false;
          event.preventDefault();
          return true;
        },
        click(view, event) {
          if (!view.editable) return false;
          const task = getTaskItem(view, event.target);
          if (!task || !isCheckboxHotspot(task.item, event)) return false;
          event.preventDefault();
          event.stopPropagation();
          view.dispatch(view.state.tr.setNodeMarkup(task.pos, undefined, {
            ...task.node.attrs,
            checked: task.node.attrs.checked !== true,
          }).scrollIntoView());
          view.focus();
          return true;
        },
      },
    },
  });
});

const mathPlugins = [
  remarkMathPlugin,
  katexOptionsCtx,
  mathInlineSchema,
  mathBlockSchema,
  mathSourceInlineSchema,
  mathSourceBlockSchema,
  imageSourceInlineSchema,
  tableSourceBlockSchema,
  mathValueEditPlugin,
  mathBlockInputRule,
  mathInlineInputRule,
].flat();

/**
 * 为 CodeMirror 流式语法高亮构建语言描述对象。
 *
 * @param {string} name 语言展示名。
 * @param {string[]} alias 语言别名集合。
 * @param {any} parser 对应的流式解析器。
 * @returns {LanguageDescription} 语言描述对象。
 */
function languageDescription(name, alias, parser) {
  return LanguageDescription.of({
    name,
    alias,
    support: new LanguageSupport(StreamLanguage.define(parser)),
  });
}

const codeLanguages = [
  languageDescription('JavaScript', ['js', 'javascript', 'jsx'], javascript),
  languageDescription('TypeScript', ['ts', 'typescript', 'tsx'], typescript),
  languageDescription('JSON', ['json'], json),
  languageDescription('HTML', ['html', 'xml'], html),
  languageDescription('XML', ['xml'], xml),
  languageDescription('CSS', ['css'], css),
  languageDescription('SCSS', ['scss', 'sass'], sCSS),
  languageDescription('Python', ['py', 'python'], python),
  languageDescription('SQL', ['sql'], sql),
  languageDescription('Shell', ['bash', 'shell', 'sh', 'powershell'], shell),
  languageDescription('C', ['c'], c),
  languageDescription('C++', ['cpp', 'c++'], cpp),
  languageDescription('Java', ['java'], java),
  languageDescription('Kotlin', ['kotlin', 'kt'], kotlin),
  languageDescription('Go', ['go'], go),
  languageDescription('Rust', ['rust', 'rs'], rust),
  languageDescription('Ruby', ['ruby', 'rb'], ruby),
  languageDescription('YAML', ['yaml', 'yml'], yaml),
  languageDescription('TOML', ['toml'], toml),
  languageDescription('Dart', ['dart'], dart),
];

const copyIconSvg = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
</svg>`;

// 与底部状态栏视图切换复用同一套预览图标，用于从源码态切到预览态。
const previewIconSvg = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

// 与底部状态栏视图切换复用同一套代码图标，用于从预览态切回源码态。
const editIconSvg = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true">
  <polyline points="16 18 22 12 16 6"/>
  <polyline points="8 6 2 12 8 18"/>
</svg>`;

/**
 * 将 Mermaid 输出包装为不可编辑的预览容器。
 *
 * @param {string} svg Mermaid 渲染得到的 SVG 文本。
 * @returns {string} 可直接注入预览区域的 HTML 字符串。
 */
function wrapMermaidPreview(svg) {
  return `<div class="md-preview__milkdown-mermaid-inline" contenteditable="false">${svg}</div>`;
}

/**
 * 将代码块语言标识转换为界面展示名称。
 *
 * @param {string} raw 原始语言标识。
 * @returns {string} 供界面显示的语言名称。
 */
function getLangDisplay(raw) {
  const key = (raw || '').toLowerCase();
  return LANG_DISPLAY[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

// Milkdown 代码块预览协议要求这里同步返回：
// - `null`：当前语言没有预览能力，界面上也不显示切换按钮；
// - `undefined`：稍后通过 `applyPreview` 异步补入预览；
// - 字符串或元素：立即可渲染的预览内容。
// 若直接返回 Promise，Milkdown 会把它当成预览内容本身，导致预览面板异常。
/**
 * 为支持的代码块语言生成预览内容。
 *
 * Milkdown 预览协议要求同步返回值仅使用 `null`、`undefined` 或立即可渲染
 * 的内容；异步结果需通过 `applyPreview` 回填。
 *
 * @param {string} language 代码块语言。
 * @param {string} content 代码块正文。
 * @param {(preview: string | Element) => void} applyPreview 异步回填预览内容的回调。
 * @returns {string | Element | null | undefined} 立即可用的预览结果或占位信号。
 */
function renderCodeBlockPreview(language, content, applyPreview) {
  if ((language || '').toLowerCase() !== 'mermaid') return null;

  (async () => {
    try {
      const { default: mermaid } = await import('mermaid');
      const isDark = document.documentElement.dataset.theme === 'dark';
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
      });
      const id = `milkdown-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { svg } = await mermaid.render(id, content);
      applyPreview(wrapMermaidPreview(svg));
    } catch (error) {
      applyPreview(wrapMermaidPreview(`<pre class="md-preview__mermaid md-preview__mermaid--error"><span>Mermaid Error:</span> ${String(error?.message || error)}</pre>`));
    }
  })();

  return undefined;
}

/**
 * 阻断只读预览区域里不该落入 ProseMirror 原生选区的交互。
 *
 * 这类节点往往是第三方渲染结果或不可编辑的原子块，若放任编辑器接管，
 * 很容易生成无效 selection，导致点击、双击或触摸选区异常。
 */
/**
 * 判断事件目标是否落在代码块工具栏等交互控件上。
 *
 * @param {EventTarget | null} target 事件目标。
 * @returns {boolean} 命中编辑器工具栏控件时返回 `true`。
 */
function isInteractiveToolbarTarget(target) {
  return target instanceof Element
    && !!target.closest('.tools, .language-button, .preview-toggle-button, .language-picker, .lang-tag');
}

/**
 * 将用户输入的语言名称或别名归一化为已知语言名。
 *
 * @param {string} raw 用户输入的语言文本。
 * @returns {string} 匹配到的标准语言名；未命中时返回空字符串。
 */
function findKnownCodeLanguageName(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  const match = codeLanguages.find((language) => (
    language.name.toLowerCase() === value
    || language.alias.some((alias) => alias.toLowerCase() === value)
  ));
  return match?.name || '';
}

/**
 * 从代码块相关 DOM 节点反查其对应的 ProseMirror 代码块节点。
 *
 * @param {any} view 当前 ProseMirror 视图。
 * @param {Element | null} dom 触发事件的 DOM 节点。
 * @returns {{pos: number, node: any, rawPos: number, depth: number} | null} 解析结果。
 */
function resolveCodeBlockNodeFromDom(view, dom) {
  if (!(dom instanceof Element)) return null;

  const rawPos = view.posAtDOM(dom, 0);
  const maxPos = view.state.doc.content.size;
  const safePos = Math.max(0, Math.min(rawPos, maxPos));
  const $pos = view.state.doc.resolve(safePos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node?.type?.name !== 'code_block') continue;
    return {
      pos: $pos.before(depth),
      node,
      rawPos,
      depth,
    };
  }

  return null;
}

/**
 * 将任意事件目标提升为可用的 DOM 元素节点。
 *
 * @param {EventTarget | null} target 原始事件目标。
 * @returns {Element | null} 对应元素节点。
 */
function getEventTargetElement(target) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/**
 * 在语言选择器输入框按下回车时提交代码块语言修改。
 *
 * @param {any} view 当前 ProseMirror 视图。
 * @param {KeyboardEvent} event 键盘事件。
 * @returns {boolean} 事件被消费时返回 `true`。
 */
function commitTypedCodeBlockLanguage(view, event) {
  if (event.key !== 'Enter') return false;

  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains('search-input')) return false;

  const picker = target.closest('.language-picker');
  const codeBlock = target.closest('.milkdown-code-block');
  if (!picker || !codeBlock) return false;

  const typedValue = target.value.trim();
  const firstListedLanguage = picker.querySelector('.language-list-item[data-language]')?.dataset.language || '';
  const nextLanguage = findKnownCodeLanguageName(typedValue) || typedValue || firstListedLanguage;
  if (!nextLanguage) return false;

  try {
    const resolved = resolveCodeBlockNodeFromDom(view, codeBlock);
    const pos = resolved?.pos ?? -1;
    const node = resolved?.node ?? null;
    if (!node || !Object.prototype.hasOwnProperty.call(node.attrs || {}, 'language')) return false;

    view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', nextLanguage).scrollIntoView());
    codeBlock.querySelector('.language-button')?.click();
    view.focus();
  } catch {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return true;
}

/**
 * 判断事件目标是否位于脚注定义区域。
 *
 * @param {EventTarget | null} target 事件目标。
 * @returns {boolean} 命中脚注定义区域时返回 `true`。
 */
function isFootnoteBackrefTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('dl[data-type="footnote_definition"]');
}

/**
 * 判断事件目标是否位于不可编辑的预览节点中。
 *
 * @param {EventTarget | null} target 事件目标。
 * @returns {boolean} 命中不可编辑预览区域时返回 `true`。
 */
function isNonEditablePreviewTarget(target) {
  return target instanceof Element
    && !isInteractiveToolbarTarget(target)
    && (
      !!target.closest('sup[data-type="footnote_reference"]')
      || isFootnoteBackrefTarget(target)
      || !!target.closest([
      '.md-preview__milkdown-mermaid-inline',
      '.md-preview__milkdown-mermaid',
      '.md-preview__mermaid',
      '.md-preview__math',
      '.md-preview__html',
      '.preview-panel',
      'img[data-mde-original-src]',
      'img[data-mde-resolved-src]',
    ].join(', '))
    );
}

/**
 * 创建只读预览区域的事件隔离处理器。
 *
 * @param {() => any} getEditor 用于延迟获取 Milkdown 实例的函数。
 * @returns {(event: Event) => void} 预览区域事件处理器。
 */
function createNonEditablePreviewSelectionHandler(getEditor) {
  return function stopNonEditablePreviewSelection(event) {
    if (!isNonEditablePreviewTarget(event.target)) return;

    const footnoteRef = event.target.closest?.('sup[data-type="footnote_reference"]');
    const footnoteBackref = !footnoteRef && isFootnoteBackrefTarget(event.target)
      ? event.target.closest('dl[data-type="footnote_definition"]')
      : null;
    if (footnoteRef || footnoteBackref) {
      const root = event.currentTarget;
      const label = footnoteRef?.dataset.label || footnoteBackref?.dataset.label || '';
      const target = footnoteRef
        ? root.querySelector(`dl[data-type="footnote_definition"][data-label="${CSS.escape(label)}"]`)
        : root.querySelector(`sup[data-type="footnote_reference"][data-label="${CSS.escape(label)}"]`);
      if (event.type === 'click' && target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('footnote-highlight');
        window.setTimeout(() => target.classList.remove('footnote-highlight'), 1200);
      }
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent?.stopImmediatePropagation?.();
      event.stopImmediatePropagation?.();
      return;
    }

    getEditor()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const target = event.target.closest([
        '.md-preview__milkdown-mermaid-inline',
        '.md-preview__milkdown-mermaid',
        '.md-preview__mermaid',
        '.md-preview__math',
        '.md-preview__html',
        '.preview-panel',
        'img[data-mde-original-src]',
        'img[data-mde-resolved-src]',
      ].join(', '));
      if (!target) return;

      try {
        const resolved = resolveCodeBlockNodeFromDom(view, target);
        const pos = resolved?.pos ?? -1;
        const node = resolved?.node ?? null;
        if (!node?.isAtom && !node?.isBlock) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView());
        view.focus();
      } catch {
        // 少数第三方预览 DOM 无法稳定映射回 ProseMirror 节点；即便如此，
        // 事件隔离仍能阻止 ProseMirror/CodeMirror 产生无效选区。
      }
    });

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent?.stopImmediatePropagation?.();
    event.stopImmediatePropagation?.();
  };
}

/**
 * 对内嵌 HTML 预览内容做最小化安全清洗。
 *
 * @param {string} value 原始 HTML 字符串。
 * @returns {string} 去除危险标签和内联脚本后的 HTML。
 */
function sanitizeMilkdownHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const attrValue = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || attrValue.startsWith('javascript:')) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return template.innerHTML;
}

/**
 * 将 HTML 占位节点渲染为只读 HTML 预览。
 *
 * @param {Element} root 编辑器根节点。
 * @returns {void}
 */
function renderMilkdownHtml(root) {
  root.querySelectorAll('span[data-type="html"]').forEach((node) => {
    const value = node.dataset.value || node.textContent || '';
    if (node.dataset.renderedValue === value) return;
    node.classList.add('md-preview__html');
    node.setAttribute('contenteditable', 'false');
    node.innerHTML = sanitizeMilkdownHtml(value);
    node.dataset.renderedValue = value;
  });
}

/**
 * 将数学节点渲染为 KaTeX 结果。
 *
 * @param {Element} root 编辑器根节点。
 * @returns {void}
 */
function renderMilkdownMath(root) {
  root.querySelectorAll(`span[data-type="${mathInlineType}"], div[data-type="${mathBlockType}"]`).forEach((node) => {
    const value = node.dataset.value || node.textContent || '';
    if (!value || node.dataset.renderedValue === value) return;
    try {
      katex.render(value, node, {
        throwOnError: false,
        strict: false,
        displayMode: node.dataset.type === mathBlockType,
      });
      node.dataset.renderedValue = value;
    } catch {
      node.textContent = value;
      node.dataset.renderedValue = value;
    }
  });
}

/**
 * 在只读模式下增强代码块显示效果。
 *
 * 负责补充 Prism 高亮、Mermaid 渲染、语言标签与复制交互。
 *
 * @param {Element | null} container 代码块所在容器。
 * @param {{readOnly: boolean, mermaidRoots: Map<Element, any>}} options 增强配置。
 * @returns {void}
 */
function enhanceCodeBlocks(container, { readOnly, mermaidRoots }) {
  if (!container || !readOnly) return;
  const toast = useToastStore.getState().toast;
  const isDark = document.documentElement.dataset.theme === 'dark';
  const seenMermaid = new Set();

  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;

    const rawLang = pre.dataset.language
      || [...code.classList].find((item) => item.startsWith('language-'))?.replace('language-', '')
      || '';

    if (rawLang) {
      pre.classList.add(`language-${rawLang}`);
      code.classList.add(`language-${rawLang}`);
    }

    if (rawLang === 'mermaid') {
      let target = pre.nextElementSibling;
      if (!target || !target.classList.contains('md-preview__milkdown-mermaid')) {
        target = document.createElement('div');
        target.className = 'md-preview__milkdown-mermaid';
        pre.after(target);
      }
      pre.style.display = 'none';
      let root = mermaidRoots.get(target);
      if (!root) {
        root = createRoot(target);
        mermaidRoots.set(target, root);
      }
      root.render(<MermaidRenderer code={code.textContent || ''} isDark={isDark} />);
      seenMermaid.add(target);
      return;
    }

    if (pre.style.display === 'none') pre.style.display = '';
    if (rawLang && rawLang !== 'mermaid' && !code.querySelector(':scope > .token')) {
      try {
        Prism.highlightElement(code);
      } catch (_) {
        // 语言声明格式异常或暂不支持时，不应影响整个编辑器继续工作。
      }
    }

    if (!rawLang || pre.querySelector(':scope > .lang-tag')) return;
    const tag = document.createElement('button');
    tag.className = 'lang-tag';
    tag.textContent = getLangDisplay(rawLang);
    tag.title = i18n.t('preview.copiedToClipboard');
    tag.addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent || '').then(() => {
        toast(i18n.t('preview.copiedToClipboard'));
      }).catch(() => {
        toast(i18n.t('preview.copyFailed'));
      });
    });
    pre.appendChild(tag);
  });

  mermaidRoots.forEach((root, node) => {
    if (seenMermaid.has(node)) return;
    root.unmount();
    mermaidRoots.delete(node);
    node.remove();
  });
}

/**
 * 根据大纲项信息在 ProseMirror 文档中定位对应节点。
 *
 * @param {any} doc 当前 ProseMirror 文档。
 * @param {{line?: number, text?: string, type?: string}} outlineItem 大纲项信息。
 * @returns {any | null} 命中的节点与位置信息；未命中时返回 `null`。
 */
function findNodeByOutlineItem(doc, { line, text, type }) {
  const cleanText = String(text || '').trim();
  const candidates = findChildren(doc, (node) => {
    if (type === 'heading') return node.type.name === 'heading';
    if (type === 'list-ordered' || type === 'list-unordered') return node.type.name === 'listItem';
    return false;
  });

  if (line) {
    const exactLine = candidates.find(({ node }) => node.attrs?.line === line);
    if (exactLine) return exactLine;
  }

  if (!cleanText) return null;
  return candidates.find(({ node }) => node.textContent.trim().startsWith(cleanText)) || null;
}

/**
 * 根据大纲项信息在只读 DOM 预览中定位对应元素。
 *
 * @param {Element | null} container 预览容器。
 * @param {{text?: string, type?: string}} outlineItem 大纲项信息。
 * @returns {Element | null} 命中的 DOM 元素。
 */
function findDomByOutlineItem(container, { text, type }) {
  if (!(container instanceof Element)) return null;
  const cleanText = String(text || '').trim();
  if (!cleanText) return null;

  const selector = type === 'heading' ? 'h1, h2, h3, h4, h5, h6' : 'li';
  const elements = container.querySelectorAll(selector);
  for (const element of elements) {
    if (element.textContent?.trim().startsWith(cleanText)) return element;
  }

  return null;
}

/**
 * 核心 Milkdown 实例。
 *
 * 负责挂载编辑器、向外暴露工具栏操作能力，并把编辑中的 Markdown
 * 通过 `editorBuffer`、脏状态与自动保存节流器同步给应用其余部分。
 */
function MilkdownInner({
  activeTabId,
  className,
  content,
  fontSize,
  lineHeight,
  onAutoSave,
  readOnly,
}, ref) {
  const wrapperRef = useRef(null);
  const editorRef = useRef(null);
  const currentTabIdRef = useRef(activeTabId);
  const onAutoSaveRef = useRef(onAutoSave);
  const dirtyTimerRef = useRef(null);
  const charTimerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const mermaidRootsRef = useRef(new Map());
  const imageCleanupsRef = useRef([]);
  const [renderTick, setRenderTick] = useState(0);
  const { openFileFromPath } = useFileManager();
  const markTabDirty = useEditorStore((s) => s.markTabDirty);
  const setCharacterCount = useEditorStore((s) => s.setCharacterCount);
  const documentPath = useMemo(() => {
    return useEditorStore.getState().tabs.find((tab) => tab.id === activeTabId)?.path || '';
  }, [activeTabId]);

  currentTabIdRef.current = activeTabId;
  onAutoSaveRef.current = onAutoSave;

  /**
   * 将编辑器内部变更批量转发到应用层副作用。
   *
   * 这里把内容缓冲、脏标记、字数统计与自动保存拆成不同节流窗口，
   * 避免每次按键都立刻触发整条 React/Zustand 链路。
   */
  const scheduleEditorSideEffects = useCallback((markdown) => {
    const tabId = currentTabIdRef.current;
    if (!tabId || readOnly) return;

    setBuffer(tabId, markdown);

    if (!dirtyTimerRef.current) {
      dirtyTimerRef.current = setTimeout(() => {
        dirtyTimerRef.current = null;
        markTabDirty(tabId, true);
      }, 200);
    }

    if (!charTimerRef.current) {
      charTimerRef.current = setTimeout(() => {
        charTimerRef.current = null;
        setCharacterCount(markdown.length);
      }, 250);
    }

    if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        onAutoSaveRef.current?.();
      }, 300);
    }
  }, [markTabDirty, readOnly, setCharacterCount]);

  const editorInfo = useEditor((root) => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, content || '');
        ctx.set(katexOptionsCtx.key, {
          throwOnError: false,
          strict: false,
        });
        ctx.set(codeBlockConfig.key, {
          ...ctx.get(codeBlockConfig.key),
          extensions: codeBlockExtensions,
          languages: codeLanguages,
          expandIcon: '',
          searchIcon: '',
          clearSearchIcon: 'x',
          searchPlaceholder: 'Search language',
          noResultText: 'No result',
          copyText: '',
          copyIcon: copyIconSvg,
          onCopy: () => useToastStore.getState().toast(i18n.t('preview.copiedToClipboard')),
          renderLanguage: (language) => getLangDisplay(language),
          renderPreview: renderCodeBlockPreview,
          previewToggleButton: (previewOnlyMode) => (previewOnlyMode ? editIconSvg : previewIconSvg),
          previewOnlyByDefault: true,
          previewLabel: 'Preview',
          previewLoading: 'Rendering...',
        });
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !readOnly,
          attributes: {
            class: readOnly ? 'milkdown-editor milkdown-editor--readonly' : 'milkdown-editor',
            'aria-label': 'Markdown WYSIWYG editor',
          },
        }));
        ctx.get(listenerCtx)
          .markdownUpdated((_, markdown, prevMarkdown) => {
            if (markdown === prevMarkdown) return;
            scheduleEditorSideEffects(markdown);
            setRenderTick((value) => value + 1);
          });
      })
      .use(commonmark)
      .use(gfm)
      .use(taskListCheckboxPlugin)
      .use(mathPlugins)
      .use(history)
      .use(codeBlockComponent)
      .use(listener);

    editorRef.current = editor;
    return editor;
  }, [activeTabId, content, readOnly, scheduleEditorSideEffects]);

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current,
    getCurrentValue: () => editorRef.current?.action(getMarkdown()) ?? content ?? '',
    handleToolbarAction(action) {
      let handled = false;
      editorRef.current?.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        const view = ctx.get(editorViewCtx);
        const run = (command, payload) => {
          handled = Boolean(commands.call(command.key, payload));
          view.focus();
        };

        switch (action?.command) {
          case 'bold':
            run(toggleStrongCommand);
            break;
          case 'italic':
            handled = toggleMark(emphasisSchema.type(ctx), { marker: '*' })(view.state, view.dispatch.bind(view));
            view.focus();
            break;
          case 'strikethrough':
            run(toggleStrikethroughCommand);
            break;
          case 'heading':
            run(wrapInHeadingCommand, action.level || 1);
            break;
          case 'blockquote':
            run(wrapInBlockquoteCommand);
            break;
          case 'table':
            run(insertTableCommand, { row: 3, col: 3 });
            break;
          case 'code':
            run(createCodeBlockCommand, '');
            break;
          case 'link':
            {
              const { from, to, empty } = view.state.selection;
              if (empty) {
                insert('[link](url)', true)(ctx);
              } else {
                const selected = getMarkdown({ from, to })(ctx) || 'link';
                replaceRange(`[${selected}](url)`, { from, to })(ctx);
              }
              handled = true;
              view.focus();
            }
            break;
          case 'image':
            run(insertImageCommand, { src: 'url', alt: 'alt', title: '' });
            break;
          case 'taskList':
            {
              const paragraph = paragraphSchema.type(ctx).createAndFill();
              const item = listItemSchema.type(ctx).create({ checked: false }, paragraph);
              const list = bulletListSchema.type(ctx).create(null, item);
              view.dispatch(view.state.tr.replaceSelectionWith(list).scrollIntoView());
            }
            handled = true;
            view.focus();
            break;
          case 'hr':
            run(insertHrCommand);
            break;
          default:
            handled = false;
        }
      });
      return handled;
    },
    insertText(text) {
      editorRef.current?.action(insert(text, true));
    },
    wrapSelection(before, after) {
      editorRef.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to, empty } = view.state.selection;
        if (empty) {
          insert(`${before}${after}`, true)(ctx);
          return;
        }
        const selected = getMarkdown({ from, to })(ctx);
        replaceRange(`${before}${selected}${after}`, { from, to })(ctx);
      });
    },
  }), [content]);

  /**
   * 根据当前主题切换 Prism 高亮样式表。
   *
   * @returns {void}
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
    const observer = new MutationObserver(() => {
      loadPrismTheme();
      setRenderTick((value) => value + 1);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      document.getElementById('prism-theme')?.remove();
    };
  }, [loadPrismTheme]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const run = () => {
      const cleanupImages = hydrateMarkdownImages(wrapper, documentPath);
      imageCleanupsRef.current.push(cleanupImages);
      renderMilkdownHtml(wrapper);
      renderMilkdownMath(wrapper);
    };

    const raf = requestAnimationFrame(run);
    const observer = new MutationObserver(run);
    observer.observe(wrapper, {
      attributes: true,
      attributeFilter: ['data-value', 'src'],
      childList: true,
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      imageCleanupsRef.current.forEach((cleanup) => cleanup?.());
      imageCleanupsRef.current = [];
    };
  }, [documentPath, readOnly]);

  useEffect(() => {
    if (!readOnly) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const run = () => enhanceCodeBlocks(wrapper, {
      readOnly,
      mermaidRoots: mermaidRootsRef.current,
    });

    const raf = requestAnimationFrame(run);
    const observer = new MutationObserver(run);
    observer.observe(wrapper, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [readOnly, renderTick]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const handleLinkClick = (event) => {
      const anchor = getEventTargetElement(event.target)?.closest('a[href]');
      const href = anchor?.getAttribute('href') || '';
      if (!anchor || !href || href.startsWith('#')) return;

      const target = resolveMarkdownLinkPath(href, documentPath);
      if (!target.internal || !target.path) return;

      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent?.stopImmediatePropagation?.();
      event.stopImmediatePropagation?.();
      const fileName = target.path.split(/[\\/]/).pop() || target.path;
      const lineHint = parseMarkdownLineHint(target.hash)
        || parseMarkdownLineHint([
          anchor.textContent || '',
          anchor.getAttribute('aria-label') || '',
          anchor.querySelector('img')?.getAttribute('alt') || '',
          anchor.querySelector('img')?.getAttribute('title') || '',
        ].filter(Boolean).join(' '));

      void openFileFromPath(target.path, fileName).then(() => {
        if (!lineHint?.line) return;
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('editor:jump-to-line', {
            detail: { line: lineHint.line },
          }));
        }, 150);
      });
    };

    wrapper.addEventListener('click', handleLinkClick, true);
    return () => wrapper.removeEventListener('click', handleLinkClick, true);
  }, [documentPath, openFileFromPath]);

  useEffect(() => {
    const handler = (e) => {
      const wrapper = wrapperRef.current;
      const detail = e.detail ?? {};
      const domTarget = findDomByOutlineItem(wrapper, detail);
      if (domTarget) {
        domTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const editor = editorRef.current;
      if (!editor) return;

      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const target = findNodeByOutlineItem(view.state.doc, detail);
        if (!target) return;

        const dom = view.nodeDOM(target.pos);
        if (dom instanceof Element) {
          dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, target.pos)).scrollIntoView());
      });
    };

    window.addEventListener('outline:jump', handler);
    return () => window.removeEventListener('outline:jump', handler);
  }, []);

  useEffect(() => {
    if (readOnly) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const handler = createNonEditablePreviewSelectionHandler(() => editorRef.current);
    const events = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart'];
    events.forEach((eventName) => {
      wrapper.addEventListener(eventName, handler, true);
    });

    return () => {
      events.forEach((eventName) => {
        wrapper.removeEventListener(eventName, handler, true);
      });
    };
  }, [readOnly]);

  useEffect(() => {
    if (readOnly) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const keydownHandler = (event) => {
      editorRef.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        commitTypedCodeBlockLanguage(view, event);
      });
    };

    wrapper.addEventListener('keydown', keydownHandler, true);
    return () => wrapper.removeEventListener('keydown', keydownHandler, true);
  }, [readOnly]);

  useEffect(() => {
    if (readOnly) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const blockNoResultInteraction = (event) => {
      const target = getEventTargetElement(event.target);
      const noResult = target?.closest('.language-list-item.no-result');
      if (!noResult) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const events = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart'];
    events.forEach((eventName) => {
      wrapper.addEventListener(eventName, blockNoResultInteraction, true);
    });

    return () => {
      events.forEach((eventName) => {
        wrapper.removeEventListener(eventName, blockNoResultInteraction, true);
      });
    };
  }, [readOnly]);

  useEffect(() => () => {
    [dirtyTimerRef, charTimerRef, saveTimerRef].forEach((timerRef) => {
      if (timerRef.current) clearTimeout(timerRef.current);
    });
    imageCleanupsRef.current.forEach((cleanup) => cleanup?.());
    imageCleanupsRef.current = [];
    mermaidRootsRef.current.forEach((root) => root.unmount());
    mermaidRootsRef.current.clear();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`md-preview md-preview--milkdown ${editorInfo.loading ? 'md-preview--stale' : ''} ${className || ''}`}
      style={{
        fontSize: `${fontSize || 14}px`,
        lineHeight: (lineHeight || 24) / (fontSize || 14),
      }}
    >
      <Milkdown />
    </div>
  );
}

const ForwardedMilkdownInner = forwardRef(MilkdownInner);

class MilkdownErrorBoundary extends Component {
  /**
   * 初始化错误边界状态。
   *
   * @param {object} props React 组件属性。
   */
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  /**
   * 在渲染阶段错误发生后，将异常同步到边界状态。
   *
   * @param {Error} error 捕获到的异常。
   * @returns {{error: Error}} 供 React 合并的状态对象。
   */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /**
   * 记录 Milkdown 初始化或渲染期间抛出的错误。
   *
   * @param {Error} error 捕获到的异常。
   * @returns {void}
   */
  componentDidCatch(error) {
    console.error('Milkdown failed to mount:', error);
  }

  /**
   * 渲染错误回退界面或正常子树。
   *
   * @returns {import('react').ReactNode} 当前错误边界的渲染结果。
   */
  render() {
    if (this.state.error) {
      return (
        <div className={`md-preview md-preview--milkdown md-preview--error ${this.props.className || ''}`}>
          <p>Markdown 所见即所得编辑器加载失败。</p>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 对外暴露的 Milkdown Markdown 组件。
 *
 * 根据当前标签、是否只读以及预览缩放同步配置，选择合适的内容源和字号，
 * 并用 ErrorBoundary 包住第三方编辑器初始化过程。
 */
const MilkdownMarkdownEditor = forwardRef(function MilkdownMarkdownEditor({
  className,
  onAutoSave,
  readOnly = false,
}, ref) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const editorFontSize = useConfigStore((s) => s.fontSize);
  const editorLineHeight = useConfigStore((s) => s.lineHeight);
  const previewFontSize = useConfigStore((s) => s.previewFontSize);
  const previewLineHeight = useConfigStore((s) => s.previewLineHeight);
  const previewZoomSync = useConfigStore((s) => s.previewZoomSync);
  const fallback = useMemo(() => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    return tab?.content || '';
  }, [activeTabId]);
  const bufferedContent = useEditorBufferContent(activeTabId, fallback, readOnly ? 240 : 10_000_000);
  const content = bufferedContent;
  const fontSize = previewZoomSync ? editorFontSize : (previewFontSize || editorFontSize);
  const lineHeight = previewZoomSync ? editorLineHeight : (previewLineHeight || editorLineHeight);

  return (
    <MilkdownErrorBoundary className={className}>
      <MilkdownProvider>
        <ForwardedMilkdownInner
          key={readOnly ? `${activeTabId}:${content}` : activeTabId}
          ref={ref}
          activeTabId={activeTabId}
          className={className}
          content={content}
          fontSize={fontSize}
          lineHeight={lineHeight}
          onAutoSave={onAutoSave}
          readOnly={readOnly}
        />
      </MilkdownProvider>
    </MilkdownErrorBoundary>
  );
});

export default MilkdownMarkdownEditor;
