import { expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { tableNodes, TableMap, CellSelection } from '@milkdown/kit/prose/tables';
import { history, undo } from '@milkdown/kit/prose/history';
import { createEditingTable, editingTableContext, editTable, handleTableKeyDown } from './milkdownTables';
import { tableDimensions, tableMarkdown } from './tableDimensions';

const base = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: { alignment: { default: 'left' } } });
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' },
  image: { inline: true, group: 'inline', attrs: { src: { default: 'test.png' } } },
  blockquote: { content: 'block+', group: 'block' },
  ...base,
  table: { ...base.table, content: 'table_header_row table_row*' },
  table_header_row: { ...base.table_row, content: 'table_header+' },
  table_row: { ...base.table_row, content: 'table_cell+' },
}, marks: { strong: {} } });
const p = (text) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
function tableWithText(rows = 3, columns = 2) {
  const table = createEditingTable(schema, rows, columns);
  let count = 0;
  return table.type.create(null, Array.from({ length: rows }, (_, r) => table.child(r).type.create(null,
    Array.from({ length: columns }, (_, c) => table.child(r).child(c).type.create({ alignment: c ? 'right' : 'left' }, p(String.fromCharCode(65 + count++)))))));
}
function viewFor(table = tableWithText(), row = 0, col = 0, nested = false) {
  const pos = nested ? 1 : 0;
  const doc = schema.nodes.doc.create(null, [nested ? schema.nodes.blockquote.create(null, table) : table, p('outside')]);
  const view = { editable: true, composing: false };
  view.state = EditorState.create({ doc, selection: TextSelection.create(doc, pos + 3 + TableMap.get(table).map[row * table.firstChild.childCount + col]), plugins: [history()] });
  view.dispatch = (tr) => { view.state = view.state.apply(tr); };
  return view;
}
const run = (view, action, size) => editTable(view.state, view.dispatch, action, size);
const key = (value) => ({ key: value, preventDefault: vi.fn() });

it('resizes both dimensions and preserves cell text, alignment and outside paragraphs', () => {
  const view = viewFor();
  run(view, 'resize', { rows: 5, columns: 4 });
  let context = editingTableContext(view.state);
  expect([context.map.height, context.map.width]).toEqual([5, 4]);
  expect(context.table.child(2).child(1).textContent).toBe('F');
  expect(context.table.child(4).child(1).attrs.alignment).toBe('right');
  run(view, 'resize', { rows: 2, columns: 1 });
  context = editingTableContext(view.state);
  expect(context.table.textContent).toBe('AC');
  expect(view.state.doc.lastChild.textContent).toBe('outside');
  view.state.doc.check();
});

it('promotes the next row when deleting the header, then permits a header-only table', () => {
  const view = viewFor();
  run(view, 'deleteRow');
  expect(editingTableContext(view.state).table.firstChild.textContent).toBe('CD');
  expect(editingTableContext(view.state).table.firstChild.firstChild.type.name).toBe('table_header');
  run(view, 'deleteRow');
  expect(editingTableContext(view.state).table.childCount).toBe(1);
  view.state.doc.check();
});

it('selects and deletes a specified column and preserves the other column', () => {
  const view = viewFor(undefined, 1, 1);
  run(view, 'selectColumn');
  expect(view.state.selection).toBeInstanceOf(CellSelection);
  expect(view.state.selection.isColSelection()).toBe(true);
  expect(handleTableKeyDown(view, key('Delete'))).toBe(true);
  expect(editingTableContext(view.state).table.textContent).toBe('ACE');
});

it('selects a specified row and Backspace deletes only that row', () => {
  const view = viewFor(undefined, 1, 0);
  run(view, 'selectRow');
  expect(view.state.selection.isRowSelection()).toBe(true);
  handleTableKeyDown(view, key('Backspace'));
  expect(editingTableContext(view.state).table.textContent).toBe('ABEF');
});

it('removes the table when all columns are deleted and leaves a valid caret', () => {
  const view = viewFor(createEditingTable(schema, 2, 1));
  run(view, 'deleteColumn');
  expect(view.state.doc.firstChild.type.name).toBe('paragraph');
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.doc.lastChild.textContent).toBe('outside');
});

it('deletes an empty table directly, and undo restores it', () => {
  const view = viewFor(createEditingTable(schema, 2, 2));
  const original = view.state.doc;
  expect(handleTableKeyDown(view, key('Backspace'))).toBe(true);
  expect(editingTableContext(view.state)).toBeNull();
  undo(view.state, view.dispatch);
  expect(view.state.doc.eq(original)).toBe(true);
});

it('does not treat an image-only table as empty or erase nonempty cells with Backspace', () => {
  const view = viewFor();
  expect(handleTableKeyDown(view, key('Backspace'))).toBe(false);
  const empty = viewFor(createEditingTable(schema, 1, 1));
  empty.dispatch(empty.state.tr.insert(4, schema.nodes.image.create()));
  expect(handleTableKeyDown(empty, key('Backspace'))).toBe(false);
});

it('deletes a selected table inside a quote without touching surrounding text', () => {
  const view = viewFor(undefined, 0, 0, true);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)));
  handleTableKeyDown(view, key('Delete'));
  expect(view.state.doc.firstChild.firstChild.type.name).toBe('paragraph');
  expect(view.state.doc.lastChild.textContent).toBe('outside');
  view.state.doc.check();
});

it.each(['|3x4|', '/table 3x4', '|3×4|'])('creates an exact table from %s on Enter', (text) => {
  const doc = schema.nodes.doc.create(null, p(text));
  const view = { editable: true, state: EditorState.create({ doc, selection: TextSelection.create(doc, text.length + 1) }) };
  view.dispatch = (tr) => { view.state = view.state.apply(tr); };
  expect(handleTableKeyDown(view, key('Enter'))).toBe(true);
  expect([view.state.doc.firstChild.childCount, view.state.doc.firstChild.firstChild.childCount]).toEqual([4, 3]);
});

it('creates a header from a Markdown pipe row and adds a body row', () => {
  const text = '| Name | Value |';
  const doc = schema.nodes.doc.create(null, p(text));
  const view = { editable: true, state: EditorState.create({ doc, selection: TextSelection.create(doc, text.length + 1) }) };
  view.dispatch = (tr) => { view.state = view.state.apply(tr); };
  handleTableKeyDown(view, key('Enter'));
  expect(view.state.doc.firstChild.firstChild.textContent).toBe('NameValue');
  expect(view.state.doc.firstChild.childCount).toBe(2);
});

it('supports Space to create a header-only table and rejects oversized quick syntax', () => {
  const build = (text) => {
    const doc = schema.nodes.doc.create(null, p(text));
    const view = { editable: true, state: EditorState.create({ doc, selection: TextSelection.create(doc, text.length + 1) }) };
    view.dispatch = (tr) => { view.state = view.state.apply(tr); };
    return view;
  };
  const view = build('|3x1|');
  expect(handleTableKeyDown(view, key(' '))).toBe(true);
  expect(view.state.doc.firstChild.childCount).toBe(1);
  expect(view.state.doc.firstChild.firstChild.childCount).toBe(3);
  expect(handleTableKeyDown(build('|999999x999999|'), key(' '))).toBe(false);
});

it('Tab on a header-only table adds a proper body row and moves to its first cell', () => {
  const view = viewFor(createEditingTable(schema, 1, 2), 0, 1);
  expect(handleTableKeyDown(view, key('Tab'))).toBe(true);
  const context = editingTableContext(view.state);
  expect(context.table.child(1).type.name).toBe('table_row');
  expect([context.top, context.left]).toEqual([1, 0]);
  view.state.doc.check();
});

it('rejects invalid or excessive dimensions and emits standard Markdown without body rows', () => {
  expect(tableDimensions(0, 3)).toBeNull();
  expect(tableDimensions(3, 1000000)).toBeNull();
  expect(tableDimensions(2.5, 3)).toBeNull();
  expect(tableMarkdown(1, 2)).toBe('|   |   |\n| --- | --- |\n');
});
