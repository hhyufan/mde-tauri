import { editTreeSource, flattenTree, parseTreeText } from '../../src/utils/mgtree';
import useDemoClock from './useDemoClock';
import useDemoComplete from './useDemoComplete';

const additions = [
  { title: '我的知识空间', parent: null },
  { title: '写作与灵感', parent: '我的知识空间' },
  { title: '每日随笔', parent: '写作与灵感' },
  { title: '创作清单', parent: '写作与灵感' },
  { title: '阅读与积累', parent: '我的知识空间' },
  { title: '阅读笔记', parent: '阅读与积累' },
  { title: '收藏的句子', parent: '阅读与积累' },
];

// Use the app's add/rename operations, not a prebuilt tree revealed with opacity.
function treeFrame(elapsed) {
  let source = '';
  let cursor = 550;
  for (const addition of additions) {
    if (elapsed < cursor) return { source, editing: null };
    const before = flattenTree(parseTreeText(source));
    const parent = before.find((node) => node.title === addition.parent);
    source = editTreeSource(source, { type: 'add', node: parent, value: '新节点' });
    const added = flattenTree(parseTreeText(source)).find((node) => node.title === '新节点');
    const duration = addition.title.length * 95;
    if (elapsed < cursor + duration + 260) {
      return {
        source,
        editing: {
          key: added.key,
          value: addition.title.slice(0, Math.max(0, Math.floor((elapsed - cursor) / 95))),
        },
      };
    }
    source = editTreeSource(source, { type: 'rename', node: added, value: addition.title });
    cursor += duration + 650;
  }
  return { source, editing: null, complete: true };
}

export default function TreeDemo({ children, onComplete }) {
  const elapsed = useDemoClock();
  const frame = treeFrame(elapsed);
  useDemoComplete(frame.complete, onComplete);
  return (
    <div className="scene-tree-demo" data-complete={Boolean(frame.complete)}>
      {children(parseTreeText(frame.source), frame.editing)}
    </div>
  );
}
