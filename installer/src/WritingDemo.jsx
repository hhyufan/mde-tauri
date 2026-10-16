import { useEffect, useRef, useState } from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { splitBlock } from '@milkdown/kit/prose/commands';
import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const sequence = [
  '# 写下新的想法',
  '## 捕捉今天的灵感',
  '让 **灵感** 自然流淌。',
  '> 好的想法，值得记录。',
];
const completed = sequence.join('\n\n');
const demoCaret = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          return DecorationSet.create(state.doc, [
            Decoration.widget(
              state.selection.head,
              () => {
                const caret = document.createElement('span');
                caret.className = 'scene-demo-caret';
                caret.setAttribute('aria-hidden', 'true');
                return caret;
              },
              { side: 1 },
            ),
          ]);
        },
      },
    }),
);

// Run real Milkdown input rules, just as typed text triggers the app's editor.
export default function WritingDemo() {
  const root = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let created = false;
    let timer;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root.current);
        ctx.set(defaultValueCtx, reduced ? completed : '');
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          editable: () => false,
          attributes: {
            class: 'milkdown-editor milkdown-editor--readonly ProseMirror',
            'aria-label': '所见即所得自动输入演示',
          },
        }));
      })
      .use(commonmark)
      .use(demoCaret);
    editor
      .create()
      .then(() => {
        created = true;
        if (disposed) {
          void editor.destroy();
          return;
        }
        if (reduced) return;
        const view = editor.ctx.get(editorViewCtx);
        const steps = sequence.flatMap((line, index) => [
          ...(index ? ['ENTER'] : []),
          ...line,
          'WAIT',
        ]);
        let index = 0;
        const type = () => {
          if (disposed || index >= steps.length) return;
          const step = steps[index++];
          if (step === 'ENTER') splitBlock(view.state, view.dispatch);
          else if (step !== 'WAIT') {
            const { from, to } = view.state.selection;
            const handled = view.someProp('handleTextInput', (handler) =>
              handler(view, from, to, step),
            );
            if (!handled) view.dispatch(view.state.tr.insertText(step, from, to));
          }
          timer = setTimeout(type, step === 'WAIT' ? 600 : 80);
        };
        timer = setTimeout(type, 400);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (created) void editor.destroy();
    };
  }, []);
  return (
    <div className="md-preview md-preview--milkdown scene-writing-demo">
      <div ref={root} />
      {failed && <p>写下新的想法，让灵感自然流淌。</p>}
    </div>
  );
}
