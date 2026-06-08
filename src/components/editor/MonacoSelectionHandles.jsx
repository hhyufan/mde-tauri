/**
 * Monaco 移动端选区拖拽手柄。
 *
 * 本文件模拟 Android 原生文本选择手柄，在触屏环境下为 Monaco 提供可拖拽的
 * 选区端点，让用户能在长按选词后继续细调选区范围。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './monaco-selection-handles.scss';

// 当前 Monaco 选区可视起点与终点上的一对可拖拽手柄。
// 它模拟 Android 系统的文本选区拖拽点，方便用户在长按选中后继续扩大或缩小范围。
// Monaco 不会直接暴露原生拖拽点，因为屏幕上可见文字并不在获得焦点的 textarea 内。
//
// 实现说明：
//   - 通过 `getScrolledVisiblePosition` 计算屏幕坐标，再配合 fixed 定位手柄。
//     手柄尖端对齐到选中文本所在行的基线，主体向下延伸，便于手指操作。
//   - 拖拽时固定选区另一端作为锚点，仅让当前手柄跟随手指移动；
//     即使拖过锚点导致 Monaco 自动交换起止顺序，选区行为仍保持可预期。
//   - 命中探测点会比手指实际位置向上偏移约 28px，避免手掌遮挡目标字符，
//     效果上类似系统放大镜的偏移，但不额外实现放大镜。

const FINGER_Y_OFFSET = 28;
const SCREEN_MARGIN = 4;

/**
 * 读取当前选区两端在屏幕中的可视坐标，并附带编辑器边界信息。
 *
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor | null | undefined} editor Monaco 编辑器实例
 * @returns {{
 *   startX: number,
 *   startY: number,
 *   endX: number,
 *   endY: number,
 *   editorLeft: number,
 *   editorRight: number,
 *   editorTop: number,
 *   editorBottom: number
 * } | null} 选区端点快照；无有效选区时返回 `null`
 */
function snapshotPositions(editor) {
  if (!editor) return null;
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return null;

  const startPos = selection.getStartPosition();
  const endPos = selection.getEndPosition();
  const visStart = editor.getScrolledVisiblePosition(startPos);
  const visEnd = editor.getScrolledVisiblePosition(endPos);
  if (!visStart || !visEnd) return null;

  const editorDomNode = editor.getDomNode();
  if (!editorDomNode) return null;
  const rect = editorDomNode.getBoundingClientRect();

  // y 表示字符行底部位置，也就是手柄尖端需要吸附的地方。
  return {
    startX: rect.left + visStart.left,
    startY: rect.top + visStart.top + (visStart.height || 20),
    endX: rect.left + visEnd.left,
    endY: rect.top + visEnd.top + (visEnd.height || 20),
    // 记录编辑器边界，便于在选区滚出可视区域时仍把手柄限制在合理范围内。
    editorLeft: rect.left,
    editorRight: rect.right,
    editorTop: rect.top,
    editorBottom: rect.bottom,
  };
}

/**
 * 渲染 Monaco 选区两端的拖拽手柄。
 *
 * @param {{
 *   editor: import('monaco-editor').editor.IStandaloneCodeEditor | null,
 *   enabled?: boolean
 * }} props 组件属性
 * @returns {JSX.Element | null} 手柄门户节点
 */
export default function MonacoSelectionHandles({ editor, enabled = true }) {
  const [positions, setPositions] = useState(null);
  const draggingRef = useRef(null);
  const startHandleRef = useRef(null);
  const endHandleRef = useRef(null);

  // 跟踪选区与滚动变化，让手柄始终跟随当前选区位置。
  useEffect(() => {
    if (!enabled || !editor) {
      setPositions(null);
      return undefined;
    }

    let rafId = 0;
    const refresh = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const next = snapshotPositions(editor);
        setPositions(next);
      });
    };

    const disposables = [
      editor.onDidChangeCursorSelection(refresh),
      editor.onDidScrollChange(refresh),
      editor.onDidChangeModel(refresh),
      editor.onDidLayoutChange(refresh),
    ];
    refresh();

    const handleResize = () => refresh();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      disposables.forEach((d) => d.dispose?.());
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, [editor, enabled]);

  /**
   * 创建指定侧手柄的按下处理器，并初始化拖拽锚点。
   *
   * @param {'start' | 'end'} side 正在拖拽的手柄侧
   * @returns {(e: import('react').PointerEvent<HTMLElement>) => void} 指针按下处理函数
   */
  const handlePointerDown = (side) => (e) => {
    if (!editor) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = editor.getSelection();
    if (!sel) return;

    const handleEl = e.currentTarget;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // 节点已分离时 setPointerCapture 可能抛错；
      // 即便如此，文档级指针事件通常仍会继续派发，只是手指移出手柄可视区域后稳定性会稍差。
    }

    // 拖拽期间将选区另一端固定为锚点。
    // 即使用户把手柄拖过锚点、导致 Monaco 自动交换起止位置，
    // 锚点仍保持不变，从而让选区几何变化更可预期。
    const anchor = side === 'start'
      ? { lineNumber: sel.endLineNumber, column: sel.endColumn }
      : { lineNumber: sel.startLineNumber, column: sel.startColumn };

    draggingRef.current = { pointerId: e.pointerId, anchor, side, handleEl };
    document.documentElement.classList.add('mde--selection-dragging');
  };

  /**
   * 在拖拽过程中持续根据手指位置更新选区。
   *
   * @param {PointerEvent | import('react').PointerEvent<HTMLElement>} e 指针移动事件
   */
  const handlePointerMove = (e) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();

    // 在手指上方一行附近做命中探测，避免手掌遮住目标字符。
    const probeY = e.clientY - FINGER_Y_OFFSET;
    let target = editor.getTargetAtClientPoint(e.clientX, probeY);
    if (!target?.position) {
      // 如果偏移后的探测点已经跑到编辑器顶部之外，再用手指真实 Y 重试，
      // 这样用户仍然能拖到第 1 行。
      target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
    }
    const newPos = target?.position;
    if (!newPos) return;

    editor.setSelection({
      startLineNumber: drag.anchor.lineNumber,
      startColumn: drag.anchor.column,
      endLineNumber: newPos.lineNumber,
      endColumn: newPos.column,
    });
  };

  /**
   * 结束拖拽并释放选区手柄的指针捕获。
   *
   * @param {PointerEvent | import('react').PointerEvent<HTMLElement>} e 指针结束事件
   */
  const handlePointerUp = (e) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      drag.handleEl?.releasePointerCapture?.(e.pointerId);
    } catch (_) {
      // 已释放则忽略。
    }
    draggingRef.current = null;
    document.documentElement.classList.remove('mde--selection-dragging');
    editor?.focus();
  };

  if (!enabled || !positions) return null;

  // 将手柄限制在屏幕范围内，避免选区部分滚出可视区后手柄直接消失。
  // 即使手柄被限制在边缘，拖拽仍可正常工作，因为 Monaco 的
  // `getTargetAtClientPoint` 接受任意客户端坐标。
  const clampX = (x) => Math.min(
    Math.max(x, SCREEN_MARGIN),
    window.innerWidth - SCREEN_MARGIN,
  );

  return createPortal(
    <>
      <span
        ref={startHandleRef}
        className="monaco-selection-handle monaco-selection-handle--start"
        style={{ left: `${clampX(positions.startX)}px`, top: `${positions.startY}px` }}
        onPointerDown={handlePointerDown('start')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <span
        ref={endHandleRef}
        className="monaco-selection-handle monaco-selection-handle--end"
        style={{ left: `${clampX(positions.endX)}px`, top: `${positions.endY}px` }}
        onPointerDown={handlePointerDown('end')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </>,
    document.body,
  );
}
