import { $nodeSchema, $view } from '@milkdown/kit/utils';
import { NodeSelection } from '@milkdown/kit/prose/state';
import i18n from '@/i18n';

export function sanitizeMilkdownHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      if (attr.name.toLowerCase().startsWith('on') || attr.value.trim().toLowerCase().startsWith('javascript:')) node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}

export const htmlBlockSchema = $nodeSchema('html_block', () => ({
  group: 'block', atom: true, isolating: true, defining: true,
  attrs: { value: { default: '' } },
  parseDOM: [{ tag: 'div[data-type="html_block"]', getAttrs: (dom) => ({ value: dom.dataset.value || '' }) }],
  toDOM: (node) => ['div', { 'data-type': 'html_block', 'data-value': node.attrs.value, class: 'md-preview__html-block', contenteditable: 'false' }, node.attrs.value],
  parseMarkdown: { match: (node) => node.type === 'mokiHtmlBlock', runner: (state, node, type) => state.addNode(type, { value: node.value }) },
  toMarkdown: { match: (node) => node.type.name === 'html_block', runner: (state, node) => state.addNode('html', undefined, node.attrs.value) },
}));

export const htmlBlockView = $view(htmlBlockSchema.node, () => (initialNode, view, getPos) => {
  let node = initialNode;
  let editing = false;
  const dom = document.createElement('div');
  dom.className = 'md-preview__html-block'; dom.dataset.type = 'html_block'; dom.contentEditable = 'false';
  const preview = document.createElement('div'); preview.className = 'md-preview__html md-preview__html-block-preview';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'md-preview__html-edit';
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-13 13H3v-5Z"/><path d="m14 5 5 5"/></svg>';
  button.setAttribute('aria-label', i18n.t('editor.editHtml')); button.dataset.mokiTooltip = i18n.t('editor.editHtml'); button.hidden = !view.editable;
  const input = document.createElement('textarea'); input.className = 'md-preview__html-input'; input.setAttribute('aria-label', i18n.t('editor.htmlContent')); input.hidden = true;
  const panel = document.createElement('div'); panel.className = 'md-preview__html-panel'; panel.hidden = true;
  const toolbar = document.createElement('div'); toolbar.className = 'md-preview__html-toolbar';
  const label = document.createElement('span'); label.textContent = 'HTML';
  const done = document.createElement('button'); done.type = 'button'; done.className = 'md-preview__html-done'; done.textContent = i18n.t('editor.finishHtml');
  done.dataset.mokiTooltip = i18n.t('editor.finishHtml');
  toolbar.append(label, done); panel.append(toolbar, input); dom.append(preview, button, panel);
  const render = () => {
    dom.dataset.value = node.attrs.value;
    preview.innerHTML = sanitizeMilkdownHtml(node.attrs.value);
    preview.dataset.empty = String(!preview.textContent.trim() && !preview.querySelector('img, video, audio, svg, hr, table'));
    if (input.value !== node.attrs.value) input.value = node.attrs.value;
  };
  const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.max(120, input.scrollHeight)}px`; };
  const edit = () => {
    if (!view.editable) return;
    editing = true; preview.hidden = true; panel.hidden = false; input.hidden = false; button.hidden = true;
    input.focus(); resize();
  };
  const finish = () => {
    if (!editing) return;
    editing = false; render(); input.hidden = true; panel.hidden = true; preview.hidden = false; button.hidden = !view.editable;
  };
  button.addEventListener('click', edit);
  preview.addEventListener('dblclick', (event) => {
    if (event.target.closest('a, button, input, select, video, audio')) return;
    event.preventDefault(); edit();
  });
  input.addEventListener('input', () => {
    const pos = getPos();
    if (typeof pos !== 'number' || input.value === node.attrs.value) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: input.value })); resize();
  });
  input.addEventListener('blur', (event) => { if (!panel.contains(event.relatedTarget)) finish(); });
  done.addEventListener('click', () => { finish(); view.focus(); });
  panel.addEventListener('focusout', (event) => { if (!panel.contains(event.relatedTarget)) finish(); });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault(); finish();
      const pos = getPos();
      if (typeof pos === 'number') view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      view.focus();
    }
  });
  render();
  return {
    dom,
    update(nextNode) {
      if (nextNode.type !== node.type) return false;
      const changed = nextNode.attrs.value !== node.attrs.value; node = nextNode;
      if (changed) {
        if (editing) {
          dom.dataset.value = node.attrs.value;
          if (input.value !== node.attrs.value) input.value = node.attrs.value;
          resize();
        } else render();
      }
      return true;
    },
    stopEvent: (event) => panel.contains(event.target) || button.contains(event.target),
    ignoreMutation: () => true,
  };
});
