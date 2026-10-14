import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { toggleStrongCommand, emphasisSchema, wrapInHeadingCommand, wrapInBlockquoteCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { insert } from '@milkdown/kit/utils';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { MENU_MOD } from '@utils/contextMenuShortcuts';

export function milkdownContextItems({ editor, target, x, y, t }) {
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const cmElement = target.closest('.cm-editor');
  const cm = cmElement ? CodeMirrorView.findFromDOM(cmElement) : null;
  if (cm && cm.state.selection.main.empty) {
    const position = cm.posAtCoords({ x, y });
    if (position != null) cm.dispatch({ selection: { anchor: position } });
  } else if (!cm && view.state.selection.empty) {
    const position = view.posAtCoords({ left: x, top: y });
    if (position) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))));
  }
  const selection = cm ? cm.state.selection : view.state.selection;
  const doc = cm ? cm.state.doc : view.state.doc;
  const selected = cm ? cm.state.sliceDoc(selection.main.from, selection.main.to)
    : selection.node?.type.name === 'html_block' ? selection.node.attrs.value
    : view.state.doc.textBetween(selection.from, selection.to, '\n\n');
  const current = () => cm ? cm.dom.isConnected && cm.state.doc === doc : view.state.doc.eq(doc);
  const restore = () => {
    if (!current()) return false;
    if (cm) { cm.dispatch({ selection }); cm.focus(); }
    else { view.dispatch(view.state.tr.setSelection(selection)); view.focus(); }
    return true;
  };
  const edit = (text) => {
    if (!restore()) return;
    if (cm) cm.dispatch(cm.state.replaceSelection(text));
    else if (text === '') view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    else editor.action(insert(text, true));
  };
  const run = (command, payload) => {
    if (!restore()) return;
    editor.action((ctx) => ctx.get(commandsCtx).call(command.key, payload));
    view.focus();
  };
  const shortcuts = { undo: `${MENU_MOD}+Z`, redo: `${MENU_MOD}+Y`, cut: `${MENU_MOD}+X`, copy: `${MENU_MOD}+C`, paste: `${MENU_MOD}+V`, selectAll: `${MENU_MOD}+A` };
  const item = (key, action, disabled = false) => ({ key, label: t(`editor.menu.${key}`), shortcut: shortcuts[key], run: action, disabled });
  const inCode = Boolean(cm || view.state.selection.$from.parent.type.spec.code);
  return [
    item('undo', () => run(undoCommand), undoDepth(view.state) === 0),
    item('redo', () => run(redoCommand), redoDepth(view.state) === 0),
    { key: 's1', separator: true },
    item('cut', async () => { await navigator.clipboard.writeText(selected); edit(''); }, !selected),
    item('copy', () => navigator.clipboard.writeText(selected), !selected),
    item('paste', async () => edit(await navigator.clipboard.readText())),
    { key: 's2', separator: true },
    item('selectAll', () => {
      if (!restore()) return;
      if (cm) cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
      else view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    }),
    { key: 's3', separator: true },
    { key: 'bold', label: t('toolbar.bold'), shortcut: `${MENU_MOD}+B`, disabled: inCode, run: () => run(toggleStrongCommand) },
    { key: 'italic', label: t('toolbar.italic'), shortcut: `${MENU_MOD}+I`, disabled: inCode, run: () => {
      if (!restore()) return;
      editor.action((ctx) => toggleMark(emphasisSchema.type(ctx), { marker: '*' })(view.state, view.dispatch.bind(view)));
    } },
    { key: 'strikethrough', label: t('toolbar.strikethrough'), shortcut: `${MENU_MOD}+Alt+X`, disabled: inCode, run: () => run(toggleStrikethroughCommand) },
    { key: 's4', separator: true },
    { key: 'heading', label: t('editor.menu.heading2'), shortcut: `${MENU_MOD}+Alt+2`, disabled: inCode, run: () => run(wrapInHeadingCommand, 2) },
    { key: 'blockquote', label: t('toolbar.blockquote'), shortcut: `${MENU_MOD}+Shift+B`, disabled: inCode, run: () => run(wrapInBlockquoteCommand) },
    { key: 'code', label: t('toolbar.code'), shortcut: `${MENU_MOD}+Alt+C`, disabled: inCode, run: () => run(createCodeBlockCommand, '') },
  ];
}
