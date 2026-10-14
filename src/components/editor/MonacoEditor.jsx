/**
 * @file Monaco 编辑器封装模块。
 *
 * 该文件负责创建 Monaco 实例、桥接缓冲区与全局状态、同步主题与语言配置，
 * 并统一接入桌面端右键菜单和移动端选区增强交互。
 */
import { useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import useLspStore from '@store/useLspStore';
import { attachMonacoLsp } from '@/services/monacoLsp';
import { languageSuggestionOptions } from '@/services/monacoLanguageServices';
import { watchMonacoProblems } from '@/services/monacoProblems';
import useProblemsStore from '@store/useProblemsStore';
import { readFileContent, openExternal } from '@utils/tauriApi';
import { externalLink } from '@utils/editorLinks';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, isMonacoShikiReady, getMonacoThemeName } from '@utils/monacoShiki';
import { setBuffer, getBuffer } from '@utils/editorBuffer';
import { getDocumentViewState, setDocumentViewState, registerDocumentViewState, requestDocumentViewStateSave } from '@utils/documentViewState';
import MonacoContextMenu from './MonacoContextMenu';
import MobileSelectionBar from './MobileSelectionBar';
import MonacoSelectionHandles from './MonacoSelectionHandles';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import { getResolvedHotkeys } from '@hooks/useHotkeys';
import { configureMonacoHotkeys, disposeMonacoHotkeys } from '@/services/monacoHotkeys';
import './monaco-editor.scss';

function documentModelInfo(tab) {
  const language = getFileLanguage(tab.name);
  if (!monaco.languages.getLanguages().some((item) => item.id === language)) monaco.languages.register({ id: language });
  return {
    value: getBuffer(tab.id, tab.content || ''),
    language,
    uri: tab.path && /^(?:[a-z]:[\\/]|\/)/i.test(tab.path)
      ? monaco.Uri.file(tab.path)
      : monaco.Uri.parse(`inmemory://mokidown/${encodeURIComponent(tab.id)}/${encodeURIComponent(tab.name)}`),
  };
}

function horizontalScrollbarOptions(wrapped) {
  return { horizontal: wrapped ? 'hidden' : 'auto', horizontalScrollbarSize: wrapped ? 0 : 6 };
}

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
const MonacoEditorComponent = forwardRef(function MonacoEditorComponent({ className, onAutoSave, appHotkeyHandlers = {} }, ref) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  // 快捷键回调通过 ref 传递：它们来自上层工作区，身份每次渲染都可能变化，
  // 放进依赖数组会导致反复重注册 Monaco 命令。
  const hotkeyHandlersRef = useRef(appHotkeyHandlers);
  hotkeyHandlersRef.current = appHotkeyHandlers;
  const modelsRef = useRef(new Map());
  const currentTabIdRef = useRef(null);
  const suppressModelChangeRef = useRef(false);
  const pendingJump = useProblemsStore((state) => state.pendingJump);

  // 编辑器只关心当前激活的是哪个标签页，不直接订阅正文内容，因此输入过程
  // 不会反向触发本组件或其他内容感知组件的 React 重渲染。
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabsRevision = useEditorStore((s) => s.tabsRevision);
  const languageRevision = useLspStore((s) => s.revision);
  const markTabDirty = useEditorStore((s) => s.markTabDirty);
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition);
  const setCharacterCount = useEditorStore((s) => s.setCharacterCount);

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

  // 说明：Monaco 自带界面文案（查找框、命令面板、右键菜单）目前固定使用其内置英文，
  // 这是有意为之的过渡状态——之前通过 `monaco-editor-nls-adapter` 在构建期重写
  // Monaco 源码实现的本地化已经整体下线，相关依赖与启动顺序约束一并移除。

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
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const models = modelsRef.current;

    const isDark = document.documentElement.dataset.theme === 'dark';
    const initialTheme = getMonacoThemeName(isDark);
    const tab = useEditorStore.getState().getActiveTab();
    const initial = tab ? documentModelInfo(tab) : null;
    const initialModel = initial ? monaco.editor.createModel(initial.value, initial.language, initial.uri) : null;
    const initialView = tab ? getDocumentViewState(tab.id, 'monaco') : null;
    if (tab) modelsRef.current.set(tab.id, { model: initialModel, viewState: initialView });
    currentTabIdRef.current = tab?.id || null;

    const editor = monaco.editor.create(containerRef.current, {
      // Create the real document once, instead of constructing and immediately
      // disposing a blank Markdown model before attaching the active file.
      model: initialModel,
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
        ...horizontalScrollbarOptions(wordWrap),
        useShadows: false,
      },
    });

    editorRef.current = editor;
    // Follow effective wrapping, including temporary runtime overrides, so an
    // unwrapped line never becomes inaccessible behind a hidden scrollbar.
    const syncHorizontalScrollbar = () => {
      const wrapped = editor.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn >= 0;
      const current = editor.getOption(monaco.editor.EditorOption.scrollbar);
      const options = horizontalScrollbarOptions(wrapped);
      if (current.horizontalScrollbarSize !== options.horizontalScrollbarSize) {
        editor.updateOptions({ scrollbar: options });
      }
    };
    editor.onDidChangeConfiguration((event) => {
      if (event.hasChanged(monaco.editor.EditorOption.wrappingInfo)
        || event.hasChanged(monaco.editor.EditorOption.scrollbar)) syncHorizontalScrollbar();
    });
    syncHorizontalScrollbar();
    if (initialView) editor.restoreViewState(initialView);
    const stopSessionView = registerDocumentViewState('monaco', () => currentTabIdRef.current, () => editor.saveViewState());
    editor.onDidChangeCursorSelection(requestDocumentViewStateSave);
    editor.onDidScrollChange(requestDocumentViewStateSave);
    setEditorInstance(editor);
    const linkOpener = monaco.editor.registerLinkOpener({
      async open(resource) {
        const url = externalLink(resource.toString());
        if (!url) return false;
        try { await openExternal(url); } catch (error) { console.error('Unable to open link:', error); }
        return true;
      },
    });

    let charCountScheduled = false;
    let charCountTimer = null;
    let autoSaveTimer = null;
    const pendingAutoSave = new Set();
    let isComposing = false;

    /**
     * 节流更新字符统计，降低频繁输入时的全局状态写入成本。
     */
    const scheduleCharCount = () => {
      if (charCountScheduled) return;
      charCountScheduled = true;
      charCountTimer = setTimeout(() => {
        charCountTimer = null;
        charCountScheduled = false;
        if (editorRef.current) {
          setCharacterCount(editorRef.current.getValue().length);
        }
      }, 250);
    };

    /**
     * 在短暂空闲后触发自动保存回调，合并连续输入期间的多次变更。
     */
    const flushAutoSave = () => {
      for (const tabId of pendingAutoSave) onAutoSaveRef.current?.(tabId);
      pendingAutoSave.clear();
    };
    const scheduleAutoSave = () => {
      if (isComposing || autoSaveTimer !== null) return;
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        if (isComposing) return;
        flushAutoSave();
      }, 300);
    };

    // 组合输入跟踪。监听器挂在编辑器自身的事件分发器上，编辑器 dispose 时会一并
    // 清理，因此这里不保存 disposable——之前把它存在局部变量里、并在「搜索跳转」
    // 事件中提前 dispose，会让 `isComposing` 永久停在释放那一刻的值。
    editor.onDidCompositionStart(() => {
      isComposing = true;
      if (autoSaveTimer !== null) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
    });
    editor.onDidCompositionEnd(() => {
      isComposing = false;
      // Monaco can emit its final content change after compositionend. Let
      // that event update the buffer before the pending save is dispatched.
      if (pendingAutoSave.size) scheduleAutoSave();
    });

    editor.onDidChangeModelContent(() => {
      if (suppressModelChangeRef.current) return;
      const tabId = currentTabIdRef.current;
      if (!tabId) return;
      const value = editor.getValue();
      // 1. 先同步写入编辑缓冲区，让预览、大纲等消费者按各自节流节奏读取。
      setBuffer(tabId, value);
      // 2. 脏标记、字数统计与自动保存统一节流，避免每次击键都穿透 Zustand。
      // markTabDirty is a no-op for an already dirty tab. Mark immediately so
      // switching within 200 ms cannot attribute this edit to the next tab.
      markTabDirty(tabId, true);
      scheduleCharCount();
      pendingAutoSave.add(tabId);
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

    initMonacoShiki()
      .then(() => {
        if (!editorRef.current) return;
        setHighlighterReady(true);
        const dark = document.documentElement.dataset.theme === 'dark';
        try {
          monaco.editor.setTheme(getMonacoThemeName(dark));
        } catch (error) {
          console.error('[mokidown/highlight] failed to apply Monaco theme:', error);
          try {
            monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
          } catch (_) {
            /* Monaco 内置主题同样不可用时保持当前主题，不影响编辑。 */
          }
        }
      })
      .catch((error) => {
        console.error('[mokidown/highlight] Monaco highlight bootstrap rejected:', error);
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
      // 这里刻意不释放组合事件监听：一旦释放，局部的 `isComposing` 就会永远停留在
      // 释放瞬间的值，此后自动保存要么彻底不再触发，要么在输入法组合中途触发。
      if (autoSaveTimer !== null) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
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

    const closedTabs = useEditorStore.subscribe((state, previous) => {
      if (state.tabs === previous.tabs) return;
      const openIds = new Set(state.tabs.map((item) => item.id));
      for (const [id, entry] of modelsRef.current) {
        if (!openIds.has(id) && entry.model !== editor.getModel()) {
          entry.model.dispose(); modelsRef.current.delete(id);
        }
      }
    });

    return () => {
      window.removeEventListener('outline:jump', handleOutlineJump);
      window.removeEventListener('editor:jump-to-line', handleSearchJump);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      if (jumpDecorTimer) clearTimeout(jumpDecorTimer);
      if (charCountTimer !== null) clearTimeout(charCountTimer);
      if (autoSaveTimer !== null) clearTimeout(autoSaveTimer);
      if (!isComposing) flushAutoSave();
      closedTabs();
      stopSessionView();
      linkOpener.dispose();
      editor.dispose();
      for (const entry of models.values()) entry.model.dispose();
      models.clear();
      editorRef.current = null;
      setEditorInstance(null);
    };
  }, []);

  // 激活标签切换时，同步替换编辑器内容。优先读取最新缓冲区内容，必要时再
  // 回退到标签页持久化内容，保证切回标签时未保存修改仍然保留。
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const tab = activeTabId
      ? useEditorStore.getState().tabs.find((t) => t.id === activeTabId) || null
      : null;
    const previousId = currentTabIdRef.current;
    const previous = modelsRef.current.get(previousId);
    if (previousId !== activeTabId && previous) {
      previous.viewState = editor.saveViewState();
      setDocumentViewState(previousId, 'monaco', previous.viewState);
    }
    if (!activeTabId || !tab) {
      currentTabIdRef.current = null;
      suppressModelChangeRef.current = true;
      editor.setModel(null);
      suppressModelChangeRef.current = false;
      return;
    }

    currentTabIdRef.current = activeTabId;
    const { value: newValue, language: lang, uri } = documentModelInfo(tab);
    let entry = modelsRef.current.get(activeTabId);
    let replacedModel = null;
    if (!entry || entry.model.uri.toString() !== uri.toString()) {
      const replaced = entry;
      entry = { model: monaco.editor.createModel(newValue, lang, uri), viewState: getDocumentViewState(activeTabId, 'monaco') };
      modelsRef.current.set(activeTabId, entry);
      replacedModel = replaced?.model;
    }
    if (editor.getModel() !== entry.model) {
      suppressModelChangeRef.current = true;
      editor.setModel(entry.model);
      if (entry.viewState) editor.restoreViewState(entry.viewState);
      suppressModelChangeRef.current = false;
      setContextMenu((menu) => menu.visible ? { ...menu, visible: false } : menu);
    }
    replacedModel?.dispose();
    const openIds = new Set(useEditorStore.getState().tabs.map((item) => item.id));
    for (const [id, cached] of modelsRef.current) {
      if (!openIds.has(id)) { cached.model.dispose(); modelsRef.current.delete(id); }
    }

    if (editor.getValue() !== newValue) {
      const pos = editor.getPosition();
      suppressModelChangeRef.current = true;
      editor.setValue(newValue);
      suppressModelChangeRef.current = false;
      if (pos) editor.setPosition(pos);
    }

    const model = editor.getModel();
    if (model) {
      useProblemsStore.getState().registerDocument({ tabId: tab.id, fileName: tab.name, filePath: tab.path || '',
        uri: model.uri.toString(), modelUri: model.uri.toString() });
      // 只在语言真的变化时才切换。`setModelLanguage` 会销毁并重建该 model 的
      // 分词状态；对 Monaco 按需加载的语言，还会重新走一遍异步 tokenizer loader。
      // 在外部改动、同步回写等场景下反复调用，会让可见行短暂失去 token，
      // 表现就是「高亮闪烁 / 部分行丢色」。
      if (model.getLanguageId() !== lang) {
        monaco.editor.setModelLanguage(model, lang);
      }
      const desiredTabSize = lang === 'mgtree' ? 2 : tabSize;
      const modelOptions = model.getOptions();
      if (modelOptions.tabSize !== desiredTabSize || !modelOptions.insertSpaces) {
        model.updateOptions({ tabSize: desiredTabSize, insertSpaces: true });
      }
    }

    setCharacterCount(newValue.length);
  }, [activeTabId, tabsRevision, languageRevision, setCharacterCount, tabSize]);

  useEffect(() => {
    if (!editorInstance || !pendingJump || pendingJump.tabId !== activeTabId) return;
    const model = editorInstance.getModel();
    if (!model) return;
    const { start, end } = pendingJump.range;
    const range = model.validateRange(new monaco.Range(start.line + 1, start.character + 1, end.line + 1, end.character + 1));
    editorInstance.setSelection(range);
    editorInstance.revealRangeInCenter(range);
    editorInstance.focus();
    useProblemsStore.getState().finishJump(pendingJump.token);
  }, [pendingJump, activeTabId, editorInstance]);

  useEffect(() => {
    if (!editorInstance) return;
    let binding;
    const bind = () => {
      binding?.dispose();
      const tab = useEditorStore.getState().getActiveTab();
      const model = editorInstance.getModel();
      editorInstance.trigger('language-services', 'hideSuggestWidget', null);
      editorInstance.trigger('language-services', 'closeParameterHints', null);
      if (model) editorInstance.updateOptions(languageSuggestionOptions(model.getLanguageId()));
      binding = model && tab ? attachMonacoLsp(monaco, model, tab) : null;
    };
    bind();
    const problemWatcher = watchMonacoProblems(monaco, editorInstance);
    const modelChanged = editorInstance.onDidChangeModel(bind);
    const languageChanged = editorInstance.onDidChangeModelLanguage(bind);
    const configChanged = useLspStore.subscribe((state, previous) => {
      if (state.revision === previous.revision) return;
      bind();
    });
    const saved = useEditorStore.subscribe((state, previous) => {
      const tab = state.tabs.find((tab) => tab.id === state.activeTabId);
      const before = previous.tabs.find((candidate) => candidate.id === tab?.id);
      if (tab && before?.modified && !tab.modified) binding?.save?.();
    });
    // Resolve definition targets into real tabs, so Monaco's navigation can open another file.
    const opener = monaco.editor.registerEditorOpener({
      async openCodeEditor(_source, resource, selection) {
        if (resource.scheme !== 'file') return false;
        try {
          const result = await readFileContent(resource.fsPath);
          if (!result.success) return false;
          useEditorStore.getState().openFile({ path: resource.fsPath,
            name: resource.path.split('/').pop(), content: result.content, encoding: result.encoding });
          setTimeout(() => {
            const position = selection?.startLineNumber
              ? { lineNumber: selection.startLineNumber, column: selection.startColumn } : selection;
            if (position) { editorInstance.setPosition(position); editorInstance.revealPositionInCenter(position); }
            editorInstance.focus();
          }, 0);
          return true;
        } catch (_) { return false; }
      },
    });
    return () => {
      binding?.dispose();
      modelChanged.dispose(); languageChanged.dispose(); configChanged(); saved(); opener.dispose(); problemWatcher.dispose();
    };
  }, [editorInstance]);

  // 编辑器获得焦点时 Monaco 会吞掉自己认识的按键，全局监听收不到事件，因此
  // 应用级快捷键必须在这里再注册一次；同时把用户改过的编辑器键位写进 Monaco。
  useEffect(() => {
    if (!editorInstance) return undefined;
    const apply = () => configureMonacoHotkeys(monaco, getResolvedHotkeys(), {
      appHandlers: hotkeyHandlersRef.current,
    });
    apply();
    // 键位变化时重配：先释放旧规则，避免旧键位残留。
    const unsubscribe = useConfigStore.subscribe((state, previous) => {
      if (state.hotkeys !== previous.hotkeys) apply();
    });
    return () => {
      unsubscribe();
      disposeMonacoHotkeys();
    };
  }, [editorInstance]);

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
        scrollbar: horizontalScrollbarOptions(wordWrap),
        tabSize: editorRef.current.getModel()?.getLanguageId() === 'mgtree' ? 2 : tabSize,
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
