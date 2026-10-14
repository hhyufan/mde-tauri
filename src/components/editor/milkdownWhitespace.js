import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { paragraphSchema, headingSchema, hardbreakSchema } from '@milkdown/kit/preset/commonmark';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { GapCursor } from '@milkdown/kit/prose/gapcursor';

export function initialEditingSelection(state) {
  if (!(state.selection instanceof NodeSelection) || state.selection.node.type.name !== 'html_block') return null;
  const text = TextSelection.findFrom(state.doc.resolve(state.selection.to), 1, true);
  if (text) return text;
  const boundary = state.doc.resolve(state.selection.to);
  return GapCursor.valid(boundary) ? new GapCursor(boundary) : null;
}

export function joinEditingParagraphs(left, right) {
  const empty = (node) => node.data?.mokiEmptyParagraph;
  // Keep one required separator; each authored empty paragraph adds one line.
  if (empty(left)) return 0;
  if (empty(right)) return 1;
  return undefined;
}

export function configureEditingWhitespace(ctx, { readOnly = false } = {}) {
  ctx.update(paragraphSchema.key, (getSchema) => (editorCtx) => {
    const schema = getSchema(editorCtx);
    return {
      ...schema,
      createGapCursor: true,
      toMarkdown: {
        ...schema.toMarkdown,
        runner(state, node) {
          if (!node.content.size) {
            state.addNode('html', undefined, '', { data: { mokiEmptyParagraph: true } });
          } else schema.toMarkdown.runner(state, node);
        },
      },
    };
  });
  ctx.update(headingSchema.key, (getSchema) => (editorCtx) => ({ ...getSchema(editorCtx), createGapCursor: true }));
  ctx.update(hardbreakSchema.key, (getSchema) => (editorCtx) => {
    const schema = getSchema(editorCtx);
    return {
      ...schema,
      parseDOM: [{ tag: 'br[data-is-inline="true"]', getAttrs: () => ({ isInline: true }) }, ...schema.parseDOM],
      toDOM: (node) => node.attrs.isInline && !readOnly
        ? ['br', { 'data-type': 'hardbreak', 'data-is-inline': 'true' }]
        : schema.toDOM(node),
    };
  });
  ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, join: [...(options.join || []), joinEditingParagraphs] }));
}
