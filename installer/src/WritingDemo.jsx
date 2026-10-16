import { useEffect, useRef, useState } from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { splitBlock, liftEmptyBlock } from '@milkdown/kit/prose/commands';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { gfm } from '@milkdown/kit/preset/gfm';
import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const sequence = [
  '# 写下新的想法',
  '## 捕捉今天的灵感',
  '让 **灵感** 自然流淌。',
  '> 好的想法，值得记录。',
  '- [x] 记录今天的灵感',
  '[ ] 写下新的故事',
];
const completed = sequence.slice(0, 5).join('\n\n') + '\n- ' + sequence[5];
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
export default function WritingDemo({ onComplete }) {
  const root = useRef(null);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(false);
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
      .use(gfm)
      .use(demoCaret);
    editor
      .create()
      .then(() => {
        created = true;
        if (disposed) {
          void editor.destroy();
          return;
        }
        if (reduced) {
          setFinished(true);
          onComplete?.();
          return;
        }
        const view = editor.ctx.get(editorViewCtx);
        const steps = sequence.flatMap((line, index) => [
          ...(index ? [index === 4 ? 'EXIT_QUOTE' : index === 5 ? 'NEXT_TASK' : 'ENTER'] : []),
          ...line,
          ...(index < sequence.length - 1 ? ['WAIT'] : []),
        ]);
        let index = 0;
        const type = () => {
          if (disposed || index >= steps.length) return;
          const step = steps[index++];
          if (step === 'ENTER') splitBlock(view.state, view.dispatch);
          else if (step === 'EXIT_QUOTE') {
            splitBlock(view.state, view.dispatch);
            liftEmptyBlock(view.state, view.dispatch);
          } else if (step === 'NEXT_TASK')
            splitListItem(view.state.schema.nodes.list_item, { checked: null })(
              view.state,
              view.dispatch,
            );
          else if (step !== 'WAIT') {
            const { from, to } = view.state.selection;
            const handled = view.someProp('handleTextInput', (handler) =>
              handler(view, from, to, step),
            );
            if (!handled) view.dispatch(view.state.tr.insertText(step, from, to));
          }
          if (index === steps.length) {
            setFinished(true);
            onComplete?.();
          } else timer = setTimeout(type, step === 'WAIT' ? 600 : 80);
        };
        timer = setTimeout(type, 400);
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
          onComplete?.();
        }
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (created) void editor.destroy();
    };
  }, [onComplete]);
  return (
    <div className="md-preview md-preview--milkdown scene-writing-demo" data-complete={finished}>
      <div ref={root} />
      {failed && <p>写下新的想法，让灵感自然流淌。</p>}
    </div>
  );
}
