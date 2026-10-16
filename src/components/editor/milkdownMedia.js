import { $prose, $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import i18n from '@/i18n';

// Keep media edits in ProseMirror transactions: serialization, undo and autosave
// must see the same document as the rendered editor.
export function mediaAt(view, position, kind) {
  const { doc } = view.state;
  const pos = Math.max(0, Math.min(position, doc.content.size));
  const node = doc.nodeAt(pos);
  if (kind !== 'link' && node?.type.name === 'image') {
    return {
      kind: 'image',
      from: pos,
      to: pos + node.nodeSize,
      node,
      address: node.attrs.src,
      text: node.attrs.alt,
    };
  }
  if (kind === 'image') return null;
  const $pos = doc.resolve(pos);
  const children = [];
  $pos.parent.forEach((child, offset) => {
    const mark = child.marks.find((m) => m.type.name === 'link');
    children.push({
      child,
      mark,
      from: $pos.start() + offset,
      to: $pos.start() + offset + child.nodeSize,
    });
  });
  let index = children.findIndex((entry) => entry.mark && entry.from <= pos && entry.to > pos);
  if (index < 0) index = children.findIndex((entry) => entry.mark && entry.to === pos);
  if (index < 0) return null;
  const mark = children[index].mark;
  let first = index;
  let last = index;
  while (first > 0 && children[first - 1].mark?.eq(mark)) first--;
  while (last + 1 < children.length && children[last + 1].mark?.eq(mark)) last++;
  const from = children[first].from;
  const to = children[last].to;
  return {
    kind: 'link',
    from,
    to,
    mark,
    address: mark.attrs.href,
    text: doc.textBetween(from, to),
  };
}

export function imageDescription(address, fallback) {
  if (/^(data|blob|content):/i.test(address)) return fallback;
  let name = address.split(/[?#]/)[0].split(/[\\/]/).pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* Keep malformed filenames readable. */
  }
  return (
    name
      .replace(/\.[a-z\d]{2,5}$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || fallback
  );
}

export function validMediaAddress(address, kind) {
  const value = address.trim();
  if (!value || [...value].some((character) => character.charCodeAt(0) < 32)) return false;
  if (/^[a-z]:[\\/]/i.test(value)) return true;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return true; // Relative files and document anchors.
  return kind === 'image'
    ? ['http', 'https', 'file', 'blob', 'asset', 'tauri', 'content'].includes(scheme) ||
        /^data:image\//i.test(value)
    : ['http', 'https', 'file', 'mailto', 'tel', 'sms'].includes(scheme);
}

export function applyMediaEdit(view, target, { address, text }, fallback) {
  const { schema } = view.state;
  const tr = view.state.tr;
  if (target.kind === 'image') {
    const attrs = {
      ...target.node?.attrs,
      src: address.trim(),
      alt: text.trim() || imageDescription(address, fallback),
    };
    if (target.node) tr.setNodeMarkup(target.from, null, attrs);
    else tr.replaceRangeWith(target.from, target.to, schema.nodes.image.create(attrs));
  } else {
    const href = address.trim();
    const label = text.trim() || href;
    const mark = schema.marks.link.create({ ...target.mark?.attrs, href });
    // Editing only the destination must preserve bold/emphasis within the label.
    if (target.mark && label === view.state.doc.textBetween(target.from, target.to))
      tr.removeMark(target.from, target.to, schema.marks.link).addMark(
        target.from,
        target.to,
        mark,
      );
    else {
      const marks =
        (target.mark
          ? view.state.doc.nodeAt(target.from)?.marks
          : view.state.selection.$from.marks()) || [];
      tr.replaceWith(
        target.from,
        target.to,
        schema.text(label, [...marks.filter((m) => m.type !== schema.marks.link), mark]),
      );
    }
    tr.removeStoredMark(schema.marks.link);
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export const milkdownMediaImageView = $view(imageSchema.node, () => (initialNode, view) => {
  let node = initialNode;
  const empty = !node.attrs.src;
  const dom = document.createElement(empty ? 'button' : 'img');
  dom.contentEditable = 'false';
  if (empty) {
    dom.type = 'button';
    dom.className = 'moki-image-empty';
    dom.dataset.mokiEmptyImage = 'true';
    dom.disabled = !view.editable;
    dom.textContent = `＋ ${i18n.t('media.imageAddress')}`;
    dom.setAttribute('aria-label', i18n.t('media.imageAddress'));
  }
  const updateAttrs = () => {
    if (!empty) {
      dom.setAttribute('src', node.attrs.src);
      dom.setAttribute('alt', node.attrs.alt || '');
      dom.setAttribute('title', node.attrs.title || '');
    }
  };
  updateAttrs();
  return {
    dom,
    update(next) {
      if (next.type !== node.type || !next.attrs.src !== empty) return false;
      if (next.attrs.src !== node.attrs.src) {
        delete dom.dataset.mokiOriginalSrc;
        delete dom.dataset.mokiResolvedSrc;
        dom.removeAttribute('src');
      }
      const sourceChanged = next.attrs.src !== node.attrs.src;
      node = next;
      // Do not replace a resolved local object URL when only alt changes.
      if (sourceChanged) updateAttrs();
      else if (!empty) {
        dom.setAttribute('alt', node.attrs.alt || '');
        dom.setAttribute('title', node.attrs.title || '');
      }
      return true;
    },
    ignoreMutation: () => true,
  };
});

export const mediaEditorKey = new PluginKey('moki-inline-media-editor');
let mediaSurfaceId = 0;
export const milkdownMediaEditor = $prose(
  () =>
    new Plugin({
      key: mediaEditorKey,
      state: {
        init: () => null,
        apply(tr, value) {
          const next = tr.getMeta(mediaEditorKey);
          if (next !== undefined)
            return next ? { ...next, key: `media-surface-${++mediaSurfaceId}` } : null;
          return value
            ? {
                ...value,
                position: tr.mapping.map(value.position),
                from: tr.mapping.map(value.from),
                to: tr.mapping.map(value.to),
              }
            : null;
        },
      },
      props: {
        decorations(state) {
          const value = mediaEditorKey.getState(state);
          if (!value) return null;
          const $position = state.doc.resolve(value.position);
          let depth = $position.depth;
          while (depth > 0 && !$position.node(depth).isTextblock) depth--;
          const position = depth ? $position.start(depth) : value.position;
          const decorations = [
            Decoration.widget(position, () => value.dom, {
              key: value.key,
              side: -1,
              marks: [],
              stopEvent: () => true,
              ignoreSelection: true,
            }),
          ];
          if (value.from < value.to) {
            decorations.push(
              value.kind === 'image'
                ? Decoration.node(value.from, value.to, { class: 'moki-media-selected' })
                : Decoration.inline(value.from, value.to, { class: 'moki-media-selected' }),
            );
          }
          return DecorationSet.create(state.doc, decorations);
        },
      },
    }),
);
