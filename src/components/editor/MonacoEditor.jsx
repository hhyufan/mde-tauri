/**
 * @file Monaco 编辑器封装模块。
 *
 * 该文件负责创建 Monaco 实例、桥接缓冲区与全局状态、同步主题与语言配置，
 * 并统一接入桌面端右键菜单和移动端选区增强交互。
 */
import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, isMonacoShikiReady, getMonacoThemeName } from '@utils/monacoShiki';
import { setBuffer, getBuffer, hasBuffer } from '@utils/editorBuffer';
import MonacoContextMenu from './MonacoContextMenu';
import MobileSelectionBar from './MobileSelectionBar';
import MonacoSelectionHandles from './MonacoSelectionHandles';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import { setMonacoLocale } from '@utils/monacoLocale';
import './monaco-editor.scss';

/**
 * Monaco 编辑器组件。
 *
 * 负责将当前活动标签映射到 Monaco model，并通过 ref 暴露插入、包裹选区等
 * 编辑能力给外层工具栏与工作区组件使用。
 *
 * @param {object} props 组件属性。
 * @param {string} [props.className] 附加到容器上的样式类名。
 * @param {Function} [props.onAutoSave] 编辑内容变化后的自动保存回调。
 * @param {import('react').ForwardedRef<object>} ref 暴露给父组件的编辑器操作句柄。
 * @returns {JSX.Element} Monaco 编辑器及其配套浮层。
 */
/**
 * Monaco 编辑器封装。
 *
 * 负责初始化编辑器实例、同步标签缓冲区、接入右键菜单与移动端选区能力，
 * 并对主题、字号、语言与自动保存等外部配置变化做增量响应。
 */
const MonacoEditorComponent = forwardRef(function MonacoEditorComponent({ className, onAutoSave }, ref) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const currentTabIdRef = useRef(null);
  const suppressModelChangeRef = useRef(false);

  // 编辑器只关心当前激活的是哪个标签页，不直接订阅正文内容，因此输入过程
  // 不会反向触发本组件或其他内容感知组件的 React 重渲染。
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabsRevision = useEditorStore((s) => s.tabsRevision);
  const markTabDirty = useEditorStore((s) => s.markTabDirty);
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition);
  const setCharacterCount = useEditorStore((s) => s.setCharacterCount);

  const language = useConfigStore((s) => s.language);
  const fontSize = useConfigStore((s) => s.fontSize);
  const fontFamilyBase = useConfigStore((s) => s.fontFamily);
  const lineHeight = useConfigStore((s) => s.lineHeight);
  const tabSize = useConfigStore((s) => s.tabSize);
  const wordWrap = useConfigStore((s) => s.wordWrap);
  const lineNumbers = useConfigStore((s) => s.lineNumbers);
  const minimap = useConfigStore((s) => s.minimap);

  const fontFamily = `'${fontFamilyBase}', 'Fira Code', Consolas, monospace`;

  const [highlighterReady, setHighlighterReady] = useState(isMonacoShikiReady());
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });
  // 这里通过 state 暴露 Monaco 实例，而不只放在 ref 中，是为了让
  // `MobileSelectionBar` 在编辑器初始化完成后重新运行副作用；若只传 ref，
  // 由于 ref 对象本身稳定，工具栏监听可能永远挂在空实例上。
  const [editorInstance, setEditorInstance] = useState(null);
  const { isAndroid, isMobileLayout, isTouchLike } = useResponsiveLayout();
  // 仅在真实移动端触摸布局或 Android 运行时启用移动端选区能力。像带触摸屏的
  // Windows 笔记本虽然也会上报触摸能力，但交互上仍更适合保留桌面端的
  // 原生选区与右键菜单流程。
  const useSelectionBar = isAndroid || (isMobileLayout && isTouchLike);
  // 使用 ref 保存最新布局标记，让初始化时只注册一次的 `onContextMenu`
  // 回调也能读到最新状态，而不需要重复订阅。
  const useSelectionBarRef = useRef(useSelectionBar);
  useSelectionBarRef.current = useSelectionBar;

  /**
   * 关闭桌面端自定义右键菜单并重置其定位状态。
   *
   * @returns {void}
   */
  const closeContextMenu = useCallback(() => {
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, []);

  // 让 Monaco 自带界面文案与应用语言保持同步。NLS 代理会在渲染时拦截
  // `localize()`，因此用户下次打开查找框、命令面板等控件时就会应用新语言。
  useEffect(() => {
    setMonacoLocale(language);
  }, [language]);

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current,
    getCurrentValue: () => editorRef.current?.getValue() ?? '',
    insertText(text) {
      const editor = editorRef.current;
      if (!editor) return;
      const selection = editor.getSelection();
      editor.executeEdits('toolbar', [{
        range: selection,
        text,
        forceMoveMarkers: true,
      }]);
      editor.focus();
    },
    wrapSelection(before, after) {
      const editor = editorRef.current;
      if (!editor) return;
      const selection = editor.getSelection();
      const selectedText = editor.getModel().getValueInRange(selection);
      editor.executeEdits('toolbar', [{
        range: selection,
        text: before + selectedText + after,
        forceMoveMarkers: true,
      }]);
      if (selectedText) {
        const newStart = selection.getStartPosition();
        editor.setSelection(new monaco.Selection(
          newStart.lineNumber,
          newStart.column + before.length,
          newStart.lineNumber,
          newStart.column + before.length + selectedText.length,
        ));
      }
      editor.focus();
    },
  }), []);

  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;

  // Monaco 实例只初始化一次，后续通过 model 与 options 更新内容和表现。
  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = document.documentElement.dataset.theme === 'dark';
    const initialTheme = getMonacoThemeName(isDark);

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'markdown',
      theme: initialTheme,
      automaticLayout: true,
      minimap,
      fontSize,
      fontFamily,
      lineHeight,
      lineNumbers: lineNumbers ? 'on' : 'off',
      wordWrap: wordWrap ? 'on' : 'off',
      wrappingIndent: 'same',
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 16, bottom: 16 },
      glyphMargin: false,
      folding: true,
      links: true,
      contextmenu: false,
      overviewRulerBorder: false,
      renderLineHighlight: 'none',
      unusualLineTerminators: 'off',
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false,
      },
    });

    editorRef.current = editor;
    setEditorInstance(editor);

    let dirtyMarkScheduled = false;
    let charCountScheduled = false;
    let autoSaveScheduled = false;

    /**
     * 延迟写入脏标记，避免每次击键都直接触发状态更新。
     */
    const scheduleDirtyMark = () => {
      if (dirtyMarkScheduled) return;
      dirtyMarkScheduled = true;
      setTimeout(() => {
        dirtyMarkScheduled = false;
        const tabId = currentTabIdRef.current;
        if (tabId) markTabDirty(tabId, true);
      }, 200);
    };

    /**
     * 节流更新字符统计，降低频繁输入时的全局状态写入成本。
     */
    const scheduleCharCount = () => {
      if (charCountScheduled) return;
      charCountScheduled = true;
      setTimeout(() => {
        charCountScheduled = false;
        if (editorRef.current) {
          setCharacterCount(editorRef.current.getValue().length);
        }
      }, 250);
    };

    /**
     * 在短暂空闲后触发自动保存回调，合并连续输入期间的多次变更。
     */
    const scheduleAutoSave = () => {
      if (autoSaveScheduled) return;
      autoSaveScheduled = true;
      setTimeout(() => {
        autoSaveScheduled = false;
        onAutoSaveRef.current?.();
      }, 300);
    };

    editor.onDidChangeModelContent(() => {
      if (suppressModelChangeRef.current) return;
      const tabId = currentTabIdRef.current;
      if (!tabId) return;
      const value = editor.getValue();
      // 1. 先同步写入编辑缓冲区，让预览、大纲等消费者按各自节流节奏读取。
      setBuffer(tabId, value);
      // 2. 脏标记、字数统计与自动保存统一节流，避免每次击键都穿透 Zustand。
      scheduleDirtyMark();
      scheduleCharCount();
      scheduleAutoSave();
    });

    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      });
    });

    // 统一的右键菜单与长按入口。Monaco 的 `onContextMenu` 既会在桌面右键时
    // 触发，也会在 Android 长按时触发，并且事件负载自带目标位置，省去了
    // 根据原始坐标手动反查命中位置的步骤。
    //
    // 同一个事件分流为两种交互：
    // 1. 触摸端：自动补出手指落点处的单词选区，再交给 `MobileSelectionBar`
    //    监听选区变化后自行展示。
    // 2. 桌面端：在鼠标位置弹出既有的 `MonacoContextMenu`。
    //
    // 两种场景下都需要阻止底层浏览器默认行为，避免 WebView 原生长按放大镜
    // 或页面级右键菜单与应用内交互相互抢占。
    editor.onContextMenu((event) => {
      const browserEvent = event.event?.browserEvent ?? event.event;
      browserEvent?.preventDefault?.();
      browserEvent?.stopPropagation?.();

      const targetPosition = event.target?.position;
      const selection = editor.getSelection();
      const selectionEmpty = !selection || selection.isEmpty();

      if (useSelectionBarRef.current) {
        // 触摸路径需要先补出一个可操作选区：先把光标放到按压位置，再扩展到
        // 周围单词范围，便于后续移动端操作条接管。
        if (targetPosition && selectionEmpty) {
          editor.setPosition(targetPosition);
          editor.focus();
          // 这里直接读取 model 的单词边界，而不是依赖 `smartSelect.expand`，
          // 因为移动端裁剪版 Monaco 未必包含对应 contribution。
          const model = editor.getModel();
          const word = model?.getWordAtPosition(targetPosition);
          if (word) {
            editor.setSelection({
              startLineNumber: targetPosition.lineNumber,
              startColumn: word.startColumn,
              endLineNumber: targetPosition.lineNumber,
              endColumn: word.endColumn,
            });
          }
        }
        // 触摸端不弹原生菜单，交由 `MobileSelectionBar` 基于新选区自行显示操作条。
        return;
      }

      // 桌面端右键路径：把已有上下文菜单钉在鼠标位置，并限制在视口范围内。
      const menuWidth = 220;
      const menuHeight = 340;
      const rawX = browserEvent?.clientX ?? 0;
      const rawY = browserEvent?.clientY ?? 0;
      const x = Math.min(rawX, window.innerWidth - menuWidth - 8);
      const y = Math.min(rawY, window.innerHeight - menuHeight - 8);
      setContextMenu({ visible: true, x, y });
    });

    initMonacoShiki().then(() => {
      if (editorRef.current) {
        setHighlighterReady(true);
        const dark = document.documentElement.dataset.theme === 'dark';
        try {
          monaco.editor.setTheme(getMonacoThemeName(dark));
        } catch (_) {
          monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
        }
      }
    });

    /**
     * 响应大纲跳转事件，将编辑器视口定位到目标行。
     *
     * @param {CustomEvent} e 包含目标行号的跳转事件。
     */
    const handleOutlineJump = (e) => {
      const { line } = e.detail ?? {};
      if (!line) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    };
    window.addEventListener('outline:jump', handleOutlineJump);

    let jumpDecoration = null;
    let jumpDecorTimer = null;
    /**
     * 响应搜索结果跳转事件，并短暂高亮目标行。
     *
     * @param {CustomEvent} e 包含目标行号的搜索跳转事件。
     */
    const handleSearchJump = (e) => {
      const { line } = e.detail ?? {};
      if (!line) return;

      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();

      if (jumpDecorTimer) clearTimeout(jumpDecorTimer);
      if (jumpDecoration) { jumpDecoration.clear(); jumpDecoration = null; }

      jumpDecoration = editor.createDecorationsCollection([{
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'search-jump-highlight',
        },
      }]);

      jumpDecorTimer = setTimeout(() => {
        jumpDecoration?.clear();
        jumpDecoration = null;
      }, 1800);
    };
    window.addEventListener('editor:jump-to-line', handleSearchJump);

    /**
     * 吞掉已取消请求带来的未处理拒绝，避免无意义的全局报错提示。
     *
     * @param {PromiseRejectionEvent} e 浏览器未处理拒绝事件。
     */
    const handleUnhandledRejection = (e) => {
      if (e.reason?.name === 'Canceled') e.preventDefault();
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('outline:jump', handleOutlineJump);
      window.removeEventListener('editor:jump-to-line', handleSearchJump);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      if (jumpDecorTimer) clearTimeout(jumpDecorTimer);
      editor.dispose();
      editorRef.current = null;
      setEditorInstance(null);
    };
  }, []);

  // 激活标签切换时，同步替换编辑器内容。优先读取最新缓冲区内容，必要时再
  // 回退到标签页持久化内容，保证切回标签时未保存修改仍然保留。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const tab = activeTabId
      ? useEditorStore.getState().tabs.find((t) => t.id === activeTabId) || null
      : null;
    if (!activeTabId || !tab) {
      currentTabIdRef.current = null;
      suppressModelChangeRef.current = true;
      editor.setValue('');
      suppressModelChangeRef.current = false;
      return;
    }

    currentTabIdRef.current = activeTabId;
    const newValue = hasBuffer(activeTabId)
      ? getBuffer(activeTabId, tab.content || '')
      : tab.content || '';

    if (editor.getValue() !== newValue) {
      const pos = editor.getPosition();
      suppressModelChangeRef.current = true;
      editor.setValue(newValue);
      suppressModelChangeRef.current = false;
      if (pos) editor.setPosition(pos);
    }

    const lang = getFileLanguage(tab.name);
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, lang);

    setCharacterCount(newValue.length);
  }, [activeTabId, tabsRevision, setCharacterCount]);

  // 主题切换时优先使用 Shiki 主题，若高亮器尚未就绪则回退到 Monaco 默认主题。
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.dataset.theme === 'dark';
      if (highlighterReady) {
        try {
          monaco.editor.setTheme(getMonacoThemeName(isDark));
        } catch (_) {
          monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
        }
      } else {
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [highlighterReady]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        fontSize,
        fontFamily,
        lineHeight,
      });
    }
  }, [fontSize, fontFamily, lineHeight]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        wordWrap: wordWrap ? 'on' : 'off',
        tabSize,
        lineNumbers: lineNumbers ? 'on' : 'off',
        minimap,
      });
    }
  }, [wordWrap, tabSize, lineNumbers, minimap]);

  return (
    <>
      <div
        ref={containerRef}
        className={`monaco-editor-container ${className || ''}`}
        // 再额外拦截一层容器级原生右键菜单，避免长按或右键冒泡穿透 Monaco
        // 视图节点后，又把宿主浏览器默认菜单弹出来。
        onContextMenu={(e) => e.preventDefault()}
      />
      {!useSelectionBar && (
        <MonacoContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          editorRef={editorRef}
        />
      )}
      <MobileSelectionBar editor={editorInstance} enabled={useSelectionBar} containerRef={containerRef} />
      <MonacoSelectionHandles editor={editorInstance} enabled={useSelectionBar} />
    </>
  );
});

export default MonacoEditorComponent;
