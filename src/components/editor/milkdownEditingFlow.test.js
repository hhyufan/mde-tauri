import { expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { handleMilkdownBlankPointerDown, handleMilkdownBlockKeyDown, moveOutsideBlock } from './milkdownEditingFlow';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    blockquote: { group: 'block', content: 'block+' },
    table: { group: 'block', content: 'table_row+', isolating: true },
    table_row: { content: 'table_cell+' },
    table_cell: { content: 'paragraph+', isolating: true },
    text: { group: 'inline' },
  },
});
const paragraph = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const code = schema.nodes.code_block.create(null, schema.text('code'));
function viewFor(doc, selection) {
  const view = { editable: true, focus: vi.fn() };
  view.state = EditorState.create({ doc, selection });
  view.dispatch = vi.fn((transaction) => { view.state = view.state.apply(transaction); });
  return view;
}

it('inserts into the correct parent for a code block inside a blockquote', () => {
  const quote = schema.nodes.blockquote.create(null, code);
  const view = viewFor(schema.nodes.doc.create(null, quote));
  expect(moveOutsideBlock(view, { node: code, pos: 1 }, 1)).toBe(true);
  expect(view.state.doc.firstChild.childCount).toBe(2);
  expect(view.state.doc.firstChild.lastChild.type.name).toBe('paragraph');
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.doc.firstChild.firstChild.eq(code)).toBe(true);
});

it('reuses adjacent text rather than inserting another empty paragraph', () => {
  const doc = schema.nodes.doc.create(null, [paragraph('before'), code, paragraph('after')]);
  const view = viewFor(doc);
  const block = { node: code, pos: doc.firstChild.nodeSize };
  moveOutsideBlock(view, block, 1);
  expect(view.state.doc.eq(doc)).toBe(true);
  expect(view.state.selection.$from.parent.textContent).toBe('after');
  expect(view.state.selection.$from.parentOffset).toBe(0);
  moveOutsideBlock(view, block, -1);
  expect(view.state.doc.eq(doc)).toBe(true);
  expect(view.state.selection.$from.parent.textContent).toBe('before');
  expect(view.state.selection.$from.parentOffset).toBe(6);
});

it('does not intercept composing keys, selection shortcuts or readonly views', () => {
  const doc = schema.nodes.doc.create(null, code);
  const view = viewFor(doc, NodeSelection.create(doc, 0));
  const target = document.createElement('div');
  const event = { key: 'Enter', ctrlKey: true, target, preventDefault: vi.fn(), stopPropagation: vi.fn(), isComposing: true };
  expect(handleMilkdownBlockKeyDown(view, event)).toBe(false);
  expect(handleMilkdownBlockKeyDown(view, { ...event, isComposing: false, keyCode: 229 })).toBe(false);
  view.composing = true;
  expect(handleMilkdownBlockKeyDown(view, { ...event, isComposing: false })).toBe(false);
  view.composing = false;
  view.editable = false;
  expect(handleMilkdownBlockKeyDown(view, { ...event, isComposing: false })).toBe(false);
  expect(view.dispatch).not.toHaveBeenCalled();
});

it('Ctrl+Enter leaves a selected block and creates prose in one transaction', () => {
  const doc = schema.nodes.doc.create(null, code);
  const view = viewFor(doc, NodeSelection.create(doc, 0));
  const event = { key: 'Enter', ctrlKey: true, target: document.createElement('div'), preventDefault: vi.fn(), stopPropagation: vi.fn() };
  expect(handleMilkdownBlockKeyDown(view, event)).toBe(true);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.doc.firstChild.eq(code)).toBe(true);
  expect(view.dispatch).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
});

function blankViewport(view) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-preview--milkdown';
  view.dom = document.createElement('div');
  wrapper.appendChild(view.dom);
  return { button: 0, target: wrapper, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

it('focuses an empty document without inserting another paragraph', () => {
  const doc = schema.nodes.doc.create(null, paragraph());
  const view = viewFor(doc);
  const event = blankViewport(view);
  expect(handleMilkdownBlankPointerDown(view, event)).toBe(true);
  expect(view.state.doc.eq(doc)).toBe(true);
  expect(view.state.selection.from).toBe(1);
  expect(view.focus).toHaveBeenCalledOnce();
});

it('creates an initial paragraph on click if the parser provided no blocks', () => {
  const view = viewFor(schema.nodes.doc.create());
  expect(handleMilkdownBlankPointerDown(view, blankViewport(view))).toBe(true);
  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
});

it('does not activate blank documents during readonly, composition or multi-touch interactions', () => {
  const view = viewFor(schema.nodes.doc.create(null, paragraph()));
  const event = blankViewport(view);
  view.editable = false;
  expect(handleMilkdownBlankPointerDown(view, event)).toBe(false);
  view.editable = true; view.composing = true;
  expect(handleMilkdownBlankPointerDown(view, event)).toBe(false);
  view.composing = false;
  expect(handleMilkdownBlankPointerDown(view, { ...event, isPrimary: false })).toBe(false);
  expect(handleMilkdownBlankPointerDown(view, { ...event, button: 2 })).toBe(false);
  expect(view.dispatch).not.toHaveBeenCalled();
});
