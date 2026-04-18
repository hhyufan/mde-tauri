import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { getFileLanguage } from '@utils/fileLanguage';
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
      console.warn('Shiki initialization failed, falling back to built-in themes:', err);
    }
  })();
  return shikiInitPromise;
}

const MonacoEditorComponent = forwardRef(function MonacoEditorComponent({ className, onAutoSave }, ref) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const suppressStoreSync = useRef(false);
  const activeTab = useEditorStore((s) => s.getActiveTab());
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
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

  const handleChangeRef = useRef(null);
  handleChangeRef.current = (value) => {
    const tab = useEditorStore.getState().getActiveTab();
    if (tab) {
      suppressStoreSync.current = true;
      updateTabContent(tab.id, value);
      suppressStoreSync.current = false;
    }
  };

  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;

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
      // Disable the unusual line terminators dialog — window.confirm is blocked in Tauri
      unusualLineTerminators: 'off',
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false,
      },
    });

    editorRef.current = editor;

    editor.onDidChangeModelContent(() => {
      handleChangeRef.current?.(editor.getValue());
      setCharacterCount(editor.getValue().length);
      onAutoSaveRef.current?.();
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

    // Outline jump-to-line
    const handleOutlineJump = (e) => {
      const { line } = e.detail ?? {};
      if (!line) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    };
    window.addEventListener('outline:jump', handleOutlineJump);

    // Search result jump-to-line with fade-out highlight
    let jumpDecoration = null;
    let jumpDecorTimer = null;
    const handleSearchJump = (e) => {
      const { line } = e.detail ?? {};
      if (!line) return;

      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();

      // Clear any previous decoration
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

    // Suppress the internal "Canceled" promise rejection Monaco throws on dispose
    // (https://github.com/microsoft/monaco-editor/issues/3455)
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

  // Sync content and language when active tab changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentValue = editor.getValue();
    const newValue = activeTab?.content ?? '';
    if (currentValue !== newValue) {
      const pos = editor.getPosition();
      editor.setValue(newValue);
      if (pos) editor.setPosition(pos);
    }
    // Update language based on file extension
    const lang = getFileLanguage(activeTab?.name);
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, lang);
    }
    // Update character count
    setCharacterCount(newValue.length);
  }, [activeTab?.id]);

  // Sync content from external changes (e.g. file watcher)
  useEffect(() => {
    if (suppressStoreSync.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const currentValue = editor.getValue();
    const newValue = activeTab?.content ?? '';
    if (currentValue !== newValue) {
      const selections = editor.getSelections();
      editor.setValue(newValue);
      if (selections) editor.setSelections(selections);
    }
  }, [activeTab?.content]);

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

  // Sync editor options from config store
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
