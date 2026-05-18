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
  createCodeBlockCommand,
  imageSchema,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleLinkCommand,
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
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state';
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
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import useToastStore from '@store/useToastStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import { setBuffer } from '@utils/editorBuffer';
import { hydrateMarkdownImages } from '@utils/markdownAssets';
import i18n from '@/i18n';
import MermaidRenderer from './MermaidRenderer';
import './markdown-preview.scss';

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

function escapeImageTitle(title) {
  return String(title || '').replace(/"/g, '\\"');
}

function imageToSource(node) {
  const alt = node.attrs.alt || '';
  const src = node.attrs.src || '';
  const title = node.attrs.title ? ` "${escapeImageTitle(node.attrs.title)}"` : '';
  return `![${alt}](${src}${title})`;
}

function parseImageSource(source) {
  const match = /^!\[([\s\S]*?)]\((\S*?)(?:\s+"([\s\S]*?)")?\)$/.exec(source);
  if (!match) return null;
  return {
    alt: match[1] || '',
    src: match[2] || '',
    title: match[3] || '',
  };
}

function tableCellText(cell) {
  return (cell.textContent || '').replace(/\|/g, '\\|').trim();
}

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

function isTableSeparator(line) {
  return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

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

const mathInlineInputRule = $inputRule(
  (ctx) => new InputRule(/(?:\$)([^$]+)(?:\$)$/, (state, match, start, end) => {
    const value = match[1] || '';
    if (!value) return null;
    return state.tr.replaceWith(start, end, mathInlineSchema.type(ctx).create({ value }));
  })
);

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

// Same eye icon used in the Footer view-mode toggle: switch from code to preview.
const previewIconSvg = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

// Same chevrons icon used in the Footer view-mode toggle: switch back to code.
const editIconSvg = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true">
  <polyline points="16 18 22 12 16 6"/>
  <polyline points="8 6 2 12 8 18"/>
</svg>`;

function wrapMermaidPreview(svg) {
  return `<div class="md-preview__milkdown-mermaid-inline" contenteditable="false">${svg}</div>`;
}

function getLangDisplay(raw) {
  const key = (raw || '').toLowerCase();
  return LANG_DISPLAY[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

// Milkdown's contract: return `null` synchronously when this language has
// no preview (so the toggle button never appears for plain code), `undefined`
// to signal an async preview that will be delivered via `applyPreview` later,
// or a string / element to render immediately. Returning a Promise here
// would be stored verbatim as the preview content and break the panel.
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

function isInteractiveToolbarTarget(target) {
  return target instanceof Element
    && !!target.closest('.tools, .language-button, .preview-toggle-button, .language-picker, .lang-tag');
}

function isNonEditablePreviewTarget(target) {
  return target instanceof Element
    && !isInteractiveToolbarTarget(target)
    && !!target.closest([
      '.md-preview__milkdown-mermaid-inline',
      '.md-preview__milkdown-mermaid',
      '.md-preview__mermaid',
      '.md-preview__math',
      '.md-preview__html',
      '.preview-panel',
      'img[data-mde-original-src]',
      'img[data-mde-resolved-src]',
    ].join(', '));
}

function createNonEditablePreviewSelectionHandler(getEditor) {
  return function stopNonEditablePreviewSelection(event) {
    if (!isNonEditablePreviewTarget(event.target)) return;

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
        const pos = view.posAtDOM(target, 0);
        const node = view.state.doc.nodeAt(pos);
        if (!node?.isAtom && !node?.isBlock) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView());
        view.focus();
      } catch {
        // Some third-party preview DOM cannot be mapped cleanly; event isolation
        // still prevents ProseMirror/CodeMirror from creating an invalid selection.
      }
    });

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent?.stopImmediatePropagation?.();
    event.stopImmediatePropagation?.();
  };
}

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
        // A malformed or unsupported language should not break the editor.
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
  const markTabDirty = useEditorStore((s) => s.markTabDirty);
  const setCharacterCount = useEditorStore((s) => s.setCharacterCount);
  const documentPath = useMemo(() => {
    return useEditorStore.getState().tabs.find((tab) => tab.id === activeTabId)?.path || '';
  }, [activeTabId]);

  currentTabIdRef.current = activeTabId;
  onAutoSaveRef.current = onAutoSave;

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
            run(toggleEmphasisCommand);
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
            run(toggleLinkCommand, { href: 'url', title: '' });
            break;
          case 'image':
            run(insertImageCommand, { src: 'url', alt: 'alt', title: '' });
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
  }, [documentPath]);

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
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Milkdown failed to mount:', error);
  }

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

const MilkdownMarkdownEditor = forwardRef(function MilkdownMarkdownEditor({
  className,
  onAutoSave,
  readOnly = false,
}, ref) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const fontSize = useConfigStore((s) => s.fontSize);
  const lineHeight = useConfigStore((s) => s.lineHeight);
  const fallback = useMemo(() => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    return tab?.content || '';
  }, [activeTabId]);
  const bufferedContent = useEditorBufferContent(activeTabId, fallback, readOnly ? 240 : 10_000_000);
  const content = bufferedContent;

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
