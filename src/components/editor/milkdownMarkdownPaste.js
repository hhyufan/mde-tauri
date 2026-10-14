import { parserCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

// Source copied from a code editor often includes highlighted HTML. Prefer
// Markdown in that case, while the stock clipboard plugin handles rich text.
export const milkdownMarkdownPaste = $prose((ctx) => new Plugin({
  props: {
    handlePaste(view, event) {
      if (!view.editable || view.state.selection.$from.parent.type.spec.code) return false;
      const data = event.clipboardData;
      const text = data?.getData('text/plain');
      if (!text) return false;
      let mode;
      try { mode = JSON.parse(data.getData('vscode-editor-data') || '{}').mode; } catch { /* Optional source metadata. */ }
      if (mode && mode !== 'markdown') return false;
      const html = data.getData('text/html');
      if (mode !== 'markdown' && (!/<(?:pre|code)(?:\s|>)/i.test(html) || /data-pm-slice\s*=/i.test(html))) return false;
      const doc = ctx.get(parserCtx)(text.replace(/\r\n?/g, '\n'));
      if (!doc) return false;
      let formatted = false;
      doc.descendants((node) => {
        if ((node.type.name !== 'paragraph' && !node.isText) || node.marks.length) formatted = true;
      });
      if (mode !== 'markdown' && !formatted) return false;
      view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView()
        .setMeta('paste', true).setMeta('uiEvent', 'paste'));
      return true;
    },
  },
}));
