import { Plugin, PluginKey, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { gapCursor } from '@milkdown/kit/prose/gapcursor';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { $prose } from '@milkdown/kit/utils';
import { isImeComposing } from '@utils/keyboard';

const enclosedBlocks = new Set(['code_block', 'table', 'math_block', 'table_source_block', 'math_source_block']);
const temporaryParagraphsKey = new PluginKey('moki-temporary-paragraphs');

// Empty caret landing places are view state, not document content. Keep them
// out of Markdown, autosave, and clipboard/file consumers until real input.
export function persistentMilkdownDocument(state) {
  const positions = temporaryParagraphsKey.getState(state) || [];
  if (!positions.length) return state.doc;
  const tr = state.tr;
  for (const pos of [...positions].sort((a, b) => b - a)) {
    const node = tr.doc.nodeAt(pos);
    if (node?.type.name === 'paragraph' && !node.content.size) tr.delete(pos, pos + node.nodeSize);
  }
  return tr.doc;
}

function cancelUnusedParagraphs(view) {
  if (!view.editable || view.composing || !temporaryParagraphsKey.getState(view.state)?.length) return;
  view.dispatch(view.state.tr.setMeta(temporaryParagraphsKey, { clear: true }).setMeta('addToHistory', false));
}

function enclosingBlock($pos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (enclosedBlocks.has(node.type.name)) return { node, pos: $pos.before(depth) };
  }
  const node = $pos.nodeAfter;
  return node && enclosedBlocks.has(node.type.name) ? { node, pos: $pos.pos } : null;
}

// Reuse adjacent prose, or insert a paragraph on demand. Opening a document
// never adds trailing nodes or modifies its Markdown just to make it editable.
export function moveOutsideBlock(view, block, direction) {
  if (!view.editable || !block) return false;
  const { state } = view;
  const pos = block.pos + (direction > 0 ? block.node.nodeSize : 0);
  const $pos = state.doc.resolve(pos);
  const sibling = direction > 0 ? $pos.nodeAfter : $pos.nodeBefore;
  const tr = state.tr;
  if (sibling?.isTextblock && !sibling.type.spec.code) {
    tr.setSelection(TextSelection.create(tr.doc, direction > 0 ? pos + 1 : pos - 1));
  } else {
    const paragraph = state.schema.nodes.paragraph;
    if (!$pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph)) return false;
    tr.insert(pos, paragraph.create());
    tr.setMeta(temporaryParagraphsKey, { add: pos });
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    tr.setStoredMarks([]);
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

// The viewport can be much taller than the contenteditable DOM. Capture clicks
// on that surrounding whitespace too, so an empty file is ready for typing.
export function handleMilkdownBlankPointerDown(view, event) {
  if (!view.editable || view.composing || event.button !== 0 || event.isPrimary === false
    || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  const wrapper = view.dom.closest('.md-preview--milkdown');
  if (!target || !wrapper?.contains(target)
    || target.closest('input, textarea, button, select, .md-code-execution-mount, .editor-context-menu')) return false;
  const { state } = view;
  const first = state.doc.firstChild;
  const empty = !first || (state.doc.childCount === 1 && first.type.name === 'paragraph' && !first.content.size);
  if (empty) {
    const tr = state.tr;
    if (!first) tr.insert(0, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, 1)).setStoredMarks([]);
    view.dispatch(tr.scrollIntoView()); view.focus();
  } else {
    // Never steal clicks on text, cells, code, images, or preview controls.
    if (target !== wrapper && target !== view.dom
      && !target.matches('.milkdown, [data-milkdown-root], .tableWrapper')) return false;
    let previous;
    state.doc.forEach((node, pos) => {
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof Element)) return;
      const content = node.type.name === 'table' ? dom.querySelector('table') || dom : dom;
      if (event.clientY > content.getBoundingClientRect().bottom) previous = { node, pos };
    });
    if (!previous) {
      const dom = view.nodeDOM(0);
      if (!first || !enclosedBlocks.has(first.type.name) || !(dom instanceof Element)
        || event.clientY >= dom.getBoundingClientRect().top) return false;
      if (!moveOutsideBlock(view, { node: first, pos: 0 }, -1)) return false;
      event.preventDefault(); event.stopPropagation(); return true;
    }
    if (enclosedBlocks.has(previous.node.type.name) || previous.node.type.name === 'heading') {
      if (!moveOutsideBlock(view, previous, 1)) return false;
    } else if (previous.node.isTextblock) {
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, previous.pos + previous.node.nodeSize - 1)).scrollIntoView());
      view.focus();
    } else return false;
  }
  event.preventDefault(); event.stopPropagation(); return true;
}

// Capture at the wrapper because CodeMirror owns its keyboard events and the
// normal ProseMirror keymap does not see them.
export function handleMilkdownBlockKeyDown(view, event) {
  if (!view.editable || view.composing || isImeComposing(event) || event.altKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('input, textarea, button, select, .md-code-execution-mount')) return false;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Home', 'End'].includes(event.key)) return false;
  const { selection } = view.state;
  if (['Home', 'End'].includes(event.key) && selection.empty && selection.$from.parent.type.name === 'heading'
    && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    // Chromium's native Home/End can land on a centered heading's decorative
    // pseudo-element. Keep the document selection in sync at its outer lines.
    const start = selection.$from.start();
    const end = selection.$from.end();
    const caret = view.coordsAtPos(selection.from);
    const first = view.coordsAtPos(start);
    const last = view.coordsAtPos(end);
    const position = event.key === 'End' && caret.bottom > last.top ? end
      : event.key === 'Home' && caret.top < first.bottom ? start : null;
    if (position == null) return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
    event.preventDefault(); event.stopPropagation(); return true;
  }
  const cmDOM = target.closest('.cm-editor');
  let block;
  let direction;
  const modifiedEnter = event.key === 'Enter' && (event.ctrlKey || event.metaKey);
  if (cmDOM) {
    const cm = CodeMirrorView.findFromDOM(cmDOM);
    if (!cm || !cm.state.selection.main.empty) return false;
    const codeDOM = cmDOM.closest('.milkdown-code-block');
    block = enclosingBlock(view.state.doc.resolve(view.posAtDOM(codeDOM, 0)));
    if (!block) return false;
    if (modifiedEnter) direction = event.shiftKey ? -1 : 1;
    else {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
      const { head } = cm.state.selection.main;
      const line = cm.state.doc.lineAt(head);
      const caret = cm.coordsAtPos(head);
      const first = cm.coordsAtPos(0);
      const last = cm.coordsAtPos(cm.state.doc.length);
      // A single long code line can wrap over several screen lines. Let the
      // editor traverse those lines before leaving the block.
      if (event.key === 'ArrowDown' && line.to === cm.state.doc.length && caret && last && caret.bottom > last.top) direction = 1;
      if (event.key === 'ArrowUp' && line.from === 0 && caret && first && caret.top < first.bottom) direction = -1;
      if (event.key === 'ArrowRight' && head === cm.state.doc.length) direction = 1;
      if (event.key === 'ArrowLeft' && head === 0) direction = -1;
    }
  } else {
    const { selection } = view.state;
    block = selection instanceof NodeSelection && enclosedBlocks.has(selection.node.type.name)
      ? { pos: selection.from, node: selection.node } : enclosingBlock(selection.$from);
    if (!block || (!selection.empty && !(selection instanceof NodeSelection))) return false;
    if (modifiedEnter) direction = event.shiftKey ? -1 : 1;
    else {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (selection instanceof NodeSelection) {
        if (['Enter', 'ArrowDown', 'ArrowRight'].includes(event.key)) direction = 1;
        if (['ArrowUp', 'ArrowLeft'].includes(event.key)) direction = -1;
      } else if (block.node.type.name === 'table') {
        // Only escape at the outermost cell, with the caret at its boundary.
        // Enter/Tab and arrows inside other cells keep their native behavior.
        const { $from } = selection;
        if ($from.pos === block.pos + block.node.nodeSize - 4 && event.key === 'ArrowDown' && view.endOfTextblock('down')) direction = 1;
        if ($from.pos === block.pos + 4 && event.key === 'ArrowUp' && view.endOfTextblock('up')) direction = -1;
      }
    }
  }
  if (!direction || !moveOutsideBlock(view, block, direction)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export const createMilkdownEditingFlowPlugin = () => new Plugin({
  key: temporaryParagraphsKey,
  state: {
    init: () => [],
    apply(tr, positions) {
      const next = [];
      for (const pos of positions) {
        const mapped = tr.mapping.mapResult(pos, 1);
        const node = tr.doc.nodeAt(mapped.pos);
        // Typing, pasting an image, or converting the paragraph to a heading
        // commits it. Never remove an existing or user-authored empty line.
        if (!mapped.deleted && node?.type.name === 'paragraph' && !node.content.size) next.push(mapped.pos);
      }
      const added = tr.getMeta(temporaryParagraphsKey)?.add;
      if (Number.isInteger(added)) next.push(added);
      return [...new Set(next)];
    },
  },
  appendTransaction(transactions, _previous, state) {
    const positions = temporaryParagraphsKey.getState(state) || [];
    const clear = transactions.some((tr) => tr.getMeta(temporaryParagraphsKey)?.clear);
    const unused = positions.filter((pos) => {
      const node = state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'paragraph' || node.content.size) return false;
      const inside = state.selection.from >= pos + 1 && state.selection.to <= pos + node.nodeSize - 1;
      return clear || !inside;
    });
    if (!unused.length) return null;
    const tr = state.tr.setMeta('addToHistory', false);
    for (const pos of unused.sort((a, b) => b - a)) tr.delete(pos, pos + state.doc.nodeAt(pos).nodeSize);
    return tr;
  },
  view(view) {
    let disposed = false;
    const document = view.dom.ownerDocument;
    const pointerdown = (event) => {
      if (event.button !== 0 || event.isPrimary === false || view.composing) return;
      const positions = temporaryParagraphsKey.getState(view.state) || [];
      const within = positions.some((pos) => view.nodeDOM(pos)?.contains(event.target));
      if (!within) cancelUnusedParagraphs(view);
    };
    const focusout = () => queueMicrotask(() => {
      if (disposed) return;
      const active = document.activeElement;
      if (active === view.dom) return;
      const positions = temporaryParagraphsKey.getState(view.state) || [];
      if (!positions.some((pos) => view.nodeDOM(pos)?.contains(active))) cancelUnusedParagraphs(view);
    });
    document.addEventListener('pointerdown', pointerdown, true);
    view.dom.addEventListener('focusout', focusout);
    return { destroy() {
      disposed = true;
      document.removeEventListener('pointerdown', pointerdown, true);
      view.dom.removeEventListener('focusout', focusout);
    } };
  },
  props: {
    handleClick(view, _pos, event) {
      if (!view.editable || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return false;
      const target = event.target instanceof Element ? event.target : null;
      const heading = target?.closest('h1,h2,h3,h4,h5,h6');
      if (heading && view.dom.contains(heading)) {
        const start = view.posAtDOM(heading, 0);
        const $start = view.state.doc.resolve(start);
        if ($start.parent.type.name !== 'heading') return false;
        const end = start + $start.parent.content.size;
        const first = view.coordsAtPos(start);
        const last = view.coordsAtPos(end);
        let position;
        if (event.clientX >= last.right && event.clientY >= last.top && event.clientY <= last.bottom) position = end;
        if (event.clientX <= first.left && event.clientY >= first.top && event.clientY <= first.bottom) position = start;
        if (position == null) return false;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
        view.focus(); return true;
      }
      if (target !== view.dom) return false;
      const last = view.state.doc.lastChild;
      if (!last) return false;
      const pos = view.state.doc.content.size - last.nodeSize;
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof Element) || event.clientY <= dom.getBoundingClientRect().bottom) return false;
      if (enclosedBlocks.has(last.type.name)) return moveOutsideBlock(view, { node: last, pos }, 1);
      if (last.type.name === 'heading') {
        return moveOutsideBlock(view, { node: last, pos }, 1);
      }
      return false;
    },
  },
});

export const milkdownEditingFlow = $prose(() => createMilkdownEditingFlowPlugin());

export const milkdownGapCursor = $prose(() => gapCursor());
