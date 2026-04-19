import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { getFileLanguage } from '@utils/fileLanguage';
import { setBuffer, getBuffer, hasBuffer } from '@utils/editorBuffer';
import './monaco-editor.scss';

const SHIKI_LANGS = [
  'markdown', 'javascript', 'typescript', 'json', 'html', 'css', 'scss',
  'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php',
  'shell', 'yaml', 'xml', 'sql', 'lua', 'kotlin', 'swift', 'vue', 'svelte',
  'toml', 'powershell', 'ini',
];

let shikiReady = false;
let shikiInitPromise = null;

async function initShiki() {
  if (shikiReady) return;
  if (shikiInitPromise) return shikiInitPromise;
  shikiInitPromise = (async () => {
    try {
      const { createHighlighter } = await import('shiki');
      const { shikiToMonaco } = await import('@shikijs/monaco');
      const highlighter = await createHighlighter({
        themes: ['one-dark-pro', 'one-light'],
        langs: SHIKI_LANGS,
      });
      shikiToMonaco(highlighter, monaco);
      shikiReady = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Shiki initialization failed, falling back to built-in themes:', err);
    }
  })();
  return shikiInitPromise;
}

const MonacoEditorComponent = forwardRef(function MonacoEditorComponent({ className, onAutoSave }, ref) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const currentTabIdRef = useRef(null);

  // The editor only needs to know which tab is active; it never
  // subscribes to content. Typing therefore can never cause this
  // component (or any other content-aware component) to re-render.
  const activeTabId = useEditorStore((s) => s.activeTabId);
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

  const [highlighterReady, setHighlighterReady] = useState(shikiReady);

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

  // Init editor exactly once.
  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = document.documentElement.dataset.theme === 'dark';
    let initialTheme;
    if (shikiReady) {
      initialTheme = isDark ? 'one-dark-pro' : 'one-light';
    } else {
      initialTheme = isDark ? 'vs-dark' : 'vs';
    }

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
      contextmenu: true,
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

    let dirtyMarkScheduled = false;
    let charCountScheduled = false;
    let autoSaveScheduled = false;

    const scheduleDirtyMark = () => {
      if (dirtyMarkScheduled) return;
      dirtyMarkScheduled = true;
      setTimeout(() => {
        dirtyMarkScheduled = false;
        const tabId = currentTabIdRef.current;
        if (tabId) markTabDirty(tabId, true);
      }, 200);
    };

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

    const scheduleAutoSave = () => {
      if (autoSaveScheduled) return;
      autoSaveScheduled = true;
      setTimeout(() => {
        autoSaveScheduled = false;
        onAutoSaveRef.current?.();
      }, 300);
    };

    editor.onDidChangeModelContent(() => {
      const tabId = currentTabIdRef.current;
      if (!tabId) return;
      const value = editor.getValue();
      // 1. Update the editor buffer synchronously — preview/outline
      //    consumers will pick this up on their own debounce.
      setBuffer(tabId, value);
      // 2. Mark dirty + character count + auto-save are throttled so
      //    typing never goes through Zustand on every keystroke.
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

    initShiki().then(() => {
      if (editorRef.current) {
        setHighlighterReady(true);
        const dark = document.documentElement.dataset.theme === 'dark';
        try {
          monaco.editor.setTheme(dark ? 'one-dark-pro' : 'one-light');
        } catch (_) {
          monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
        }
      }
    });

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
    };
  }, []);

  // Switch the editor's content when the active tab changes. We read the
  // freshest content out of the editor buffer (or fall back to the tab's
  // persisted content) so that switching back to a tab keeps unsaved
  // edits intact.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!activeTabId) {
      currentTabIdRef.current = null;
      editor.setValue('');
      return;
    }
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    currentTabIdRef.current = activeTabId;
    const newValue = hasBuffer(activeTabId)
      ? getBuffer(activeTabId, tab.content || '')
      : tab.content || '';

    if (editor.getValue() !== newValue) {
      const pos = editor.getPosition();
      editor.setValue(newValue);
      if (pos) editor.setPosition(pos);
    }

    const lang = getFileLanguage(tab.name);
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, lang);

    setCharacterCount(newValue.length);
  }, [activeTabId, setCharacterCount]);

  // Theme switching with Shiki themes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.dataset.theme === 'dark';
      if (highlighterReady) {
        try {
          monaco.editor.setTheme(isDark ? 'one-dark-pro' : 'one-light');
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

  return <div ref={containerRef} className={`monaco-editor-container ${className || ''}`} />;
});

export default MonacoEditorComponent;
