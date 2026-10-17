import { $prose, $view } from '@milkdown/kit/utils';
import { tableSchema } from '@milkdown/kit/preset/gfm';
import { NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables';
import i18n from '@/i18n';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, tableDimensions } from './tableDimensions';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TablePicker from './TablePicker';

/**
 * 鼠标离开表格后延迟收起工具的时长。
 *
 * 短暂延迟避免鼠标擦过边缘时让布局反复收放。
 */
const TOOL_HIDE_DELAY = 180;

export function createEditingTable(schema, rows, columns) {
  if (!tableDimensions(rows, columns)) return null;
  return schema.nodes.table.create(null, Array.from({ length: rows }, (_, row) => (
    schema.nodes[row ? 'table_row' : 'table_header_row'].create(null,
      Array.from({ length: columns }, () => schema.nodes[row ? 'table_cell' : 'table_header'].createAndFill()))
  )));
}

export function editingTableContext(state) {
  const { selection } = state;
  let table, pos;
  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    table = selection.node; pos = selection.from;
  } else {
    const $cell = selection instanceof CellSelection ? selection.$anchorCell : selection.$from;
    for (let depth = $cell.depth; depth > 0; depth--) {
      if ($cell.node(depth).type.name === 'table') { table = $cell.node(depth); pos = $cell.before(depth); break; }
    }
  }
  if (!table) return null;
  const map = TableMap.get(table);
  let top = 0, bottom = map.height, left = 0, right = map.width;
  if (!(selection instanceof NodeSelection)) {
    const cellOffset = ($cell) => {
      if (selection instanceof CellSelection) return $cell.pos - pos - 1;
      for (let depth = $cell.depth; depth > 0; depth--) {
        if (['cell', 'header_cell'].includes($cell.node(depth).type.spec.tableRole)) return $cell.before(depth) - pos - 1;
      }
      return map.map[0];
    };
    const anchor = map.findCell(cellOffset(selection instanceof CellSelection ? selection.$anchorCell : selection.$from));
    const head = selection instanceof CellSelection ? map.findCell(cellOffset(selection.$headCell)) : anchor;
    top = Math.min(anchor.top, head.top); bottom = Math.max(anchor.bottom, head.bottom);
    left = Math.min(anchor.left, head.left); right = Math.max(anchor.right, head.right);
  }
  return { table, pos, map, top, bottom, left, right };
}

function cellPosition(table, pos, row, col) {
  const map = TableMap.get(table);
  return pos + 1 + map.map[row * map.width + col];
}

export function editTable(state, dispatch, action, dimensions) {
  const context = editingTableContext(state);
  if (!context) return false;
  const { table, pos, map, top, bottom, left, right } = context;
  if (action === 'selectRow' || action === 'selectColumn') {
    const first = cellPosition(table, pos, action === 'selectRow' ? top : 0, action === 'selectRow' ? 0 : left);
    const last = cellPosition(table, pos, action === 'selectRow' ? bottom - 1 : map.height - 1, action === 'selectRow' ? map.width - 1 : right - 1);
    dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, first, last)));
    return true;
  }
  if (action === 'resize' && !tableDimensions(dimensions?.rows, dimensions?.columns)) return false;
  let grid = Array.from({ length: map.height }, (_, row) => Array.from({ length: map.width }, (_, col) => {
    const offset = map.map[row * map.width + col], rect = map.findCell(offset);
    return rect.top === row && rect.left === col ? table.nodeAt(offset) : null;
  }));
  let row = top, col = left;
  switch (action) {
    case 'addRowBefore': grid.splice(top, 0, Array(map.width).fill(null)); break;
    case 'addRowAfter': grid.splice(bottom, 0, Array(map.width).fill(null)); row = bottom; break;
    case 'addColumnBefore': grid.forEach((cells) => cells.splice(left, 0, null)); break;
    case 'addColumnAfter': grid.forEach((cells) => cells.splice(right, 0, null)); col = right; break;
    case 'deleteRow': grid.splice(top, bottom - top); break;
    case 'deleteColumn': grid.forEach((cells) => cells.splice(left, right - left)); break;
    case 'resize':
      grid = Array.from({ length: dimensions.rows }, (_, r) => Array.from({ length: dimensions.columns }, (_, c) => grid[r]?.[c] || null));
      break;
    case 'deleteTable': grid = []; break;
    default: return false;
  }
  if (!grid.length || !grid[0].length) {
    const tr = state.tr.replaceWith(pos, pos + table.nodeSize, state.schema.nodes.paragraph.create());
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
    return true;
  }
  if (!tableDimensions(grid.length, grid[0].length)) return false;
  const rows = grid.map((cells, r) => state.schema.nodes[r ? 'table_row' : 'table_header_row'].create(null,
    cells.map((cell, c) => {
      const type = state.schema.nodes[r ? 'table_cell' : 'table_header'];
      const attrs = { ...cell?.attrs, colspan: 1, rowspan: 1, colwidth: null,
        alignment: grid[0][c]?.attrs.alignment || table.firstChild.child(Math.min(c, table.firstChild.childCount - 1)).attrs.alignment };
      return cell ? type.create(attrs, cell.content, cell.marks) : type.createAndFill(attrs);
    })));
  const next = table.type.create(table.attrs, rows);
  row = Math.min(row, rows.length - 1); col = Math.min(col, grid[0].length - 1);
  const tr = state.tr.replaceWith(pos, pos + table.nodeSize, next);
  dispatch?.(tr.setSelection(TextSelection.create(tr.doc, cellPosition(next, pos, row, col) + 2)).scrollIntoView());
  return true;
}

export function handleTableKeyDown(view, event) {
  if (!view.editable || view.composing || event.isComposing || event.keyCode === 229) return false;
  if (event.target instanceof Element && event.target.closest('.moki-table__tools')) return false;
  const { $from, empty } = view.state.selection;
  if (['Enter', ' '].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
    && empty && $from.parent.type.name === 'paragraph' && $from.parentOffset === $from.parent.content.size) {
    const text = $from.parent.textContent;
    const size = text.match(/^(?:\|(\d+)[xX×](\d+)\||\/table\s+(\d+)[xX×](\d+))$/);
    const headers = event.key === 'Enter' && !size && /^\|.+\|$/.test(text) ? text.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|')) : null;
    const dimensions = size ? tableDimensions(Number(size[2] || size[4]), Number(size[1] || size[3])) : headers && tableDimensions(2, headers.length);
    if (dimensions) {
      let table = createEditingTable(view.state.schema, dimensions.rows, dimensions.columns);
      if (headers) {
        const header = view.state.schema.nodes.table_header_row.create(null, headers.map((value) => view.state.schema.nodes.table_header.create(null,
          view.state.schema.nodes.paragraph.create(null, value ? view.state.schema.text(value) : null))));
        table = table.type.create(null, [header, table.child(1)]);
      }
      const pos = $from.before();
      const tr = view.state.tr.replaceWith(pos, $from.after(), table);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 4)).scrollIntoView());
      event.preventDefault(); return true;
    }
  }
  const context = editingTableContext(view.state);
  if (!context) return false;
  const { selection } = view.state;
  if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    && selection.empty && context.bottom === context.map.height && context.right === context.map.width) {
    if (!editTable(view.state, view.dispatch, 'addRowAfter')) return false;
    const next = editingTableContext(view.state);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPosition(next.table, next.pos, next.map.height - 1, 0) + 2)));
    event.preventDefault(); return true;
  }
  if (['Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    let action;
    let hasContent = false;
    context.table.descendants((node) => { if (node.isText ? node.text.trim() : node.isLeaf) hasContent = true; });
    if (selection instanceof NodeSelection || (!hasContent && selection.empty)) action = 'deleteTable';
    else if (selection instanceof CellSelection) {
      if (selection.isRowSelection() && selection.isColSelection()) action = 'deleteTable';
      else if (selection.isRowSelection()) action = 'deleteRow';
      else if (selection.isColSelection()) action = 'deleteColumn';
    }
    if (action) { event.preventDefault(); return editTable(view.state, view.dispatch, action); }
  }
  return false;
}

export const milkdownTableKeys = $prose(() => new Plugin({
  props: { handleKeyDown: handleTableKeyDown },
}));

export function configureEditingTables(ctx) {
  // GFM permits a header-only table. Keeping one mandatory body row prevented deleting the last row.
  ctx.update(tableSchema.key, (getSchema) => (editorCtx) => ({ ...getSchema(editorCtx), content: 'table_header_row table_row*' }));
}

export const milkdownTableView = $view(tableSchema.node, () => (initialNode, view, getPos) => {
  let node = initialNode, pickerRoot = null, hoverCell = null, disposed = false;
  const dom = document.createElement('div'); dom.className = 'moki-table tableWrapper';
  const scroll = document.createElement('div'); scroll.className = 'moki-table__scroll';
  const table = document.createElement('table'), contentDOM = document.createElement('tbody'); table.append(contentDOM); scroll.append(table);
  const controls = document.createElement('div'); controls.className = 'moki-table__tools'; controls.contentEditable = 'false';
  controls.hidden = !view.editable;
  const panel = document.createElement('div'); panel.className = 'moki-table__picker';
  dom.append(scroll, controls); controls.append(panel);
  const ensureCell = (row = 0, col = 0) => {
    const pos = getPos();
    if (!view.editable || typeof pos !== 'number') return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPosition(node, pos, row, col) + 2)));
    return true;
  };
  const closePicker = () => {
    if (!pickerRoot) return;
    const root = pickerRoot; pickerRoot = null;
    edit.setAttribute('aria-expanded', 'false');
    queueMicrotask(() => root.unmount());
    document.removeEventListener('pointerdown', outside);
    if (!disposed && !dom.matches(':hover')) hideToolsSoon();
  };
  const outside = (event) => { if (!controls.contains(event.target)) closePicker(); };
  const button = (label, className, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = className;
    button.dataset.mokiTooltip = label; button.setAttribute('aria-label', label);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', action); return button;
  };
  const edit = button(i18n.t('table.resize'), 'moki-table__edit', () => {
    if (pickerRoot) { closePicker(); return; }
    const pos = getPos();
    if (!view.editable || typeof pos !== 'number') return;
    if (editingTableContext(view.state)?.pos !== pos) ensureCell();
    /*
     * 面板高度是固定的（约 340px），表格靠下时向下会伸出编辑区被裁。
     * 打开前按「按钮到裁剪边界底部」的余量写一个 CSS 变量，面板据此限高并在内部滚动。
     */
    let room = null;
    for (let node = dom.parentElement; node; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
        room = node.getBoundingClientRect().bottom - edit.getBoundingClientRect().bottom - 12;
        break;
      }
    }
    if (room !== null) dom.style.setProperty('--moki-table-picker-room', `${Math.max(180, Math.round(room))}px`);
    edit.setAttribute('aria-expanded', 'true');
    pickerRoot = createRoot(panel);
    pickerRoot.render(createElement(TablePicker, {
      initialRows: node.childCount, initialColumns: node.firstChild.childCount, resize: true,
      onClose: () => { closePicker(); view.focus(); },
      onInsert: (rows, columns) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        if (editingTableContext(view.state)?.pos !== pos) ensureCell();
        editTable(view.state, view.dispatch, 'resize', { rows, columns }); closePicker(); view.focus();
      },
    }));
    document.addEventListener('pointerdown', outside);
  });
  edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M15 3v18M3 15h18"/></svg>';
  edit.setAttribute('aria-expanded', 'false');
  controls.append(edit);
  const insert = (axis) => {
    if (!hoverCell) return;
    const { row, col } = hoverCell;
    if (!ensureCell(row, col)) return;
    editTable(view.state, view.dispatch, axis === 'row' ? 'addRowAfter' : 'addColumnAfter'); view.focus();
  };
  const addRow = button(i18n.t('table.addRowAfter'), 'moki-table__insert moki-table__insert--row', () => insert('row'));
  const addCol = button(i18n.t('table.addColumnAfter'), 'moki-table__insert moki-table__insert--column', () => insert('column'));
  addRow.textContent = '+'; addCol.textContent = '+'; addRow.hidden = true; addCol.hidden = true; controls.append(addRow, addCol);
  contentDOM.addEventListener('pointermove', (event) => {
    const cell = event.target.closest('th,td');
    if (!cell || !view.editable) return;
    hoverCell = { row: cell.parentElement.rowIndex, col: cell.cellIndex };
    const box = dom.getBoundingClientRect(), rect = cell.getBoundingClientRect();
    addRow.hidden = node.childCount >= MAX_TABLE_ROWS;
    addCol.hidden = node.firstChild.childCount >= MAX_TABLE_COLUMNS;
    addRow.style.top = `${rect.bottom - box.top - 9}px`;
    addCol.style.left = `${Math.min(rect.right - box.left - 9, box.width - 20)}px`;
    addCol.style.top = `${scroll.getBoundingClientRect().top - box.top - 17}px`;
  });
  // Keep controls usable while the resize picker is open or receiving keyboard input.
  let hideTimer = null;
  const showTools = () => {
    if (!view.editable) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    dom.classList.add('moki-table--tools-visible');
  };
  const hideToolsSoon = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (pickerRoot) return;
      dom.classList.remove('moki-table--tools-visible');
      addRow.hidden = true; addCol.hidden = true;
    }, TOOL_HIDE_DELAY);
  };
  dom.addEventListener('pointerenter', showTools);
  dom.addEventListener('pointerleave', hideToolsSoon);

  return {
    dom, contentDOM,
    update(next) { if (next.type !== node.type) return false; node = next; controls.hidden = !view.editable; addRow.hidden = true; addCol.hidden = true; hoverCell = null; return true; },
    stopEvent: (event) => controls.contains(event.target),
    ignoreMutation: (mutation) => controls.contains(mutation.target) || (mutation.type === 'attributes' && mutation.target === dom),
    destroy() {
      disposed = true;
      if (hideTimer) clearTimeout(hideTimer);
      dom.removeEventListener('pointerenter', showTools);
      dom.removeEventListener('pointerleave', hideToolsSoon);
      closePicker();
    },
  };
});

