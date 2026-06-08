/**
 * Monaco 移动端选区动作条。
 *
 * 本文件为触屏环境补齐 Monaco 缺失的系统选区菜单体验，在选中文本后提供
 * 剪切、复制、粘贴与全选等常用动作，并兼容部分 Android WebView 的长按缺陷。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './mobile-selection-bar.scss';

// 悬浮在当前 Monaco 选区上方、适合触屏操作的动作条。
//
// 存在原因：
//   - Monaco 会把文本渲染到自己的 DOM 中，并通过 TouchHandler 接管触摸事件，
//     因此 Android 上既不会自然出现系统文本选择工具条，也不会自然出现桌面端右键菜单。
//   - Monaco 内建剪贴板动作（如 `editor.action.clipboardCutAction`）依赖
//     `document.execCommand`，而它在 Tauri Android WebView 中并不稳定。
//     因此这里优先直接走 `navigator.clipboard`，并通过 `executeEdits`
//     应用编辑，和项目桌面端上下文菜单的处理方式保持一致。
//
// 触发路径：
//   1. `editor.onContextMenu`：在 MonacoEditor 中注册，长按或右键后通过
//      smartSelect.expand 选中单词，随后这里会因选区变化而显示动作条。
//   2. 触摸长按兜底：部分 Android WebView 对 `user-select: none` 的视图节点
//      不会派发 `contextmenu`。下面的 pointerdown/up 定时器会兜底处理，
//      通过 `editor.getTargetAtClientPoint` 找到点击位置并手动选中单词。

const BAR_GAP_ABOVE = 12;
const BAR_HEIGHT = 40;
const BAR_MARGIN = 8;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 10; // 超过该像素位移后，将触摸视为拖动而不是长按

/**
 * 依据当前选区的可视位置，计算动作条应该显示的屏幕坐标。
 *
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor | null | undefined} editor Monaco 编辑器实例
 * @returns {{ x: number, y: number } | null} 动作条锚点坐标；无有效选区时返回 `null`
 */
function computeBarPosition(editor) {
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

  const anchorX = rect.left + (visStart.left + visEnd.left) / 2;
  const aboveY = rect.top + visStart.top - BAR_GAP_ABOVE - BAR_HEIGHT;
  const belowY = rect.top + visEnd.top + (visEnd.height || 20) + BAR_GAP_ABOVE;

  let y = aboveY;
  if (aboveY < BAR_MARGIN) y = belowY;

  return { x: anchorX, y };
}

/**
 * 在指定位置尝试选中整个单词；若该位置不是单词，则仅移动光标。
 *
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor | null | undefined} editor Monaco 编辑器实例
 * @param {{ lineNumber: number, column: number } | null | undefined} position 目标位置
 * @returns {boolean} 是否成功选中了单词
 */
function selectWordAt(editor, position) {
  if (!editor || !position) return false;
  const model = editor.getModel();
  if (!model) return false;
  const word = model.getWordAtPosition(position);
  if (!word) {
    editor.setPosition(position);
    return false;
  }
  editor.setSelection({
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn,
  });
  return true;
}

/**
 * 渲染移动端文本选区动作条。
 *
 * @param {{
 *   editor: import('monaco-editor').editor.IStandaloneCodeEditor | null,
 *   enabled?: boolean,
 *   containerRef?: import('react').RefObject<HTMLElement | null>
 * }} props 组件属性
 * @returns {JSX.Element | null} 动作条门户节点
 */
export default function MobileSelectionBar({ editor, enabled = true, containerRef }) {
  const { t } = useTranslation();
  const barRef = useRef(null);
  const [state, setState] = useState({ visible: false, x: 0, y: 0 });

  // 长按兜底逻辑：处理某些 WebView 不触发 onContextMenu 的情况。
  useEffect(() => {
    if (!enabled || !editor) return undefined;
    const container = containerRef?.current;
    if (!container) return undefined;

    let timerId = 0;
    let activeId = null;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = 0;
      }
      activeId = null;
    };

    const onPointerDown = (e) => {
      // 仅处理单个主触点；鼠标与多指触控继续交给 Monaco 自己处理。
      if (e.pointerType !== 'touch' || !e.isPrimary) {
        cancel();
        return;
      }
      activeId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;

      cancel();
      timerId = setTimeout(() => {
        timerId = 0;
        if (activeId === null) return;
        const target = editor.getTargetAtClientPoint(startX, startY);
        const position = target?.position;
        if (!position) return;
        editor.focus();
        selectWordAt(editor, position);
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e) => {
      if (!timerId || e.pointerId !== activeId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    };

    const onPointerEnd = (e) => {
      if (e.pointerId === activeId) cancel();
    };

    container.addEventListener('pointerdown', onPointerDown, { passive: true });
    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerup', onPointerEnd, { passive: true });
    container.addEventListener('pointercancel', onPointerEnd, { passive: true });

    return () => {
      cancel();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd);
      container.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [editor, enabled, containerRef]);

  // 根据选区位置控制工具条的显示与定位。
  useEffect(() => {
    if (!enabled || !editor) {
      setState((s) => (s.visible ? { ...s, visible: false } : s));
      return undefined;
    }

    let rafId = 0;
    const refresh = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const pos = computeBarPosition(editor);
        if (!pos) {
          setState((s) => (s.visible ? { ...s, visible: false } : s));
          return;
        }
        const width = barRef.current?.offsetWidth ?? 240;
        const halfWidth = width / 2;
        const minX = BAR_MARGIN + halfWidth;
        const maxX = window.innerWidth - BAR_MARGIN - halfWidth;
        const clampedX = Math.min(Math.max(pos.x, minX), maxX);
        const maxY = window.innerHeight - BAR_MARGIN - BAR_HEIGHT;
        const clampedY = Math.min(Math.max(pos.y, BAR_MARGIN), maxY);
        setState({ visible: true, x: clampedX, y: clampedY });
      });
    };

    const disposables = [
      editor.onDidChangeCursorSelection(refresh),
      editor.onDidScrollChange(refresh),
      editor.onDidChangeModel(refresh),
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

  // 动作处理。
  // 剪贴板优先通过 navigator.clipboard 执行，以提高 Android WebView
  // 中的稳定性；Monaco 内建动作依赖 execCommand，在移动端经常静默失败。
  /**
   * 读取当前选区文本。
   *
   * @returns {string} 当前选区内容；无有效选区时返回空字符串
   */
  const getSelectionText = () => {
    if (!editor) return '';
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || selection.isEmpty()) return '';
    return model.getValueInRange(selection);
  };

  /**
   * 复制当前选区内容。
   *
   * @param {Event | import('react').SyntheticEvent | undefined} e 触发事件
   * @returns {Promise<void>}
   */
  const handleCopy = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const text = getSelectionText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // 最后兜底回退到 Monaco 自带动作，它内部仍然使用 execCommand。
      editor?.trigger('selection-bar', 'editor.action.clipboardCopyAction', null);
    }
    editor?.focus();
  };

  /**
   * 剪切当前选区内容。
   *
   * @param {Event | import('react').SyntheticEvent | undefined} e 触发事件
   * @returns {Promise<void>}
   */
  const handleCut = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!editor) return;
    const selection = editor.getSelection();
    const text = getSelectionText();
    if (!text || !selection) return;
    try {
      await navigator.clipboard.writeText(text);
      editor.executeEdits('selection-bar-cut', [{ range: selection, text: '' }]);
    } catch (_) {
      editor.trigger('selection-bar', 'editor.action.clipboardCutAction', null);
    }
    editor.focus();
  };

  /**
   * 从剪贴板读取文本并插入到当前光标或选区位置。
   *
   * @param {Event | import('react').SyntheticEvent | undefined} e 触发事件
   * @returns {Promise<void>}
   */
  const handlePaste = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      // 有选区时执行替换；没有选区时在当前光标处构造一个零宽范围用于纯插入。
      const selection = editor.getSelection();
      const pos = editor.getPosition();
      const range = selection ?? (pos
        ? { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }
        : null);
      if (!range) return;
      editor.executeEdits('selection-bar-paste', [{ range, text, forceMoveMarkers: true }]);
    } catch (_) {
      editor.trigger('selection-bar', 'editor.action.clipboardPasteAction', null);
    }
    editor.focus();
  };

  /**
   * 选中当前模型中的全部文本。
   *
   * @param {Event | import('react').SyntheticEvent | undefined} e 触发事件
   */
  const handleSelectAll = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const fullRange = model.getFullModelRange();
    editor.setSelection(fullRange);
    editor.focus();
  };

  if (!state.visible) return null;

  const items = [
    { key: 'cut', label: t('editor.menu.cut'), onClick: handleCut },
    { key: 'copy', label: t('editor.menu.copy'), onClick: handleCopy },
    { key: 'paste', label: t('editor.menu.paste'), onClick: handlePaste },
    { key: 'selectAll', label: t('editor.menu.selectAll'), onClick: handleSelectAll },
  ];

  return createPortal(
    <div
      ref={barRef}
      className="mobile-selection-bar"
      style={{ left: `${state.x}px`, top: `${state.y}px` }}
      // 阻止按下阶段导致编辑器失焦或选区提前折叠，确保后续点击动作能正常执行。
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="mobile-selection-bar__btn"
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
