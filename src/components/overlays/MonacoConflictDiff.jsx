import { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, isMonacoShikiReady, getMonacoThemeName } from '@utils/monacoShiki';

function countLines(content = '') {
  if (!content) return 1;
  return content.split('\n').length;
}

/**
 * 冲突对比视图。
 *
 * 使用 Monaco Diff Editor 并排展示本地与远端版本，方便用户在解决同步冲突
 * 时快速判断差异并选择保留哪一侧内容。
 *
 * @param {object} props 组件属性。
 * @param {string} props.original 本地版本内容。
 * @param {string} props.modified 远端版本内容。
 * @param {string} props.fileName 当前文件名，用于推断语言。
 * @param {string} props.localLabel 左侧标签文案。
 * @param {string} props.remoteLabel 右侧标签文案。
 * @param {string} props.theme 当前主题标识。
 * @param {number} props.fontSize 编辑器字体大小。
 * @param {string} props.fontFamily 编辑器字体族。
 * @param {number} props.lineHeight 编辑器行高。
 * @param {number} props.tabSize 制表符宽度。
 */
export default function MonacoConflictDiff({
  original,
  modified,
  fileName,
  localLabel,
  remoteLabel,
  theme,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
}) {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const diffEditorRef = useRef(null);
  const originalModelRef = useRef(null);
  const modifiedModelRef = useRef(null);
  const [highlighterReady, setHighlighterReady] = useState(isMonacoShikiReady());
  const [paneWidths, setPaneWidths] = useState({ left: 0, right: 0 });

  const language = useMemo(() => getFileLanguage(fileName || ''), [fileName]);
  const lineNumbersMinChars = useMemo(
    () => Math.max(2, String(Math.max(countLines(original), countLines(modified))).length),
    [original, modified],
  );
  const monacoFontFamily = useMemo(
    () => `'${fontFamily}', 'Fira Code', Consolas, monospace`,
    [fontFamily],
  );
  const latestRef = useRef(null);
  latestRef.current = { original, modified, language, theme, lineNumbersMinChars, tabSize, fontSize, monacoFontFamily, lineHeight };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    // StrictMode replays mount effects. Do not start worker diffs for that
    // immediately disposed instance, whose models would vanish mid-request.
    const frame = requestAnimationFrame(() => {
      const { original, modified, language, theme, lineNumbersMinChars, tabSize, fontSize, monacoFontFamily, lineHeight } = latestRef.current;
      const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: getMonacoThemeName(theme === 'dark'),
        automaticLayout: true,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        enableSplitViewResizing: true,
        renderOverviewRuler: false,
        overviewRulerBorder: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        roundedSelection: false,
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 10,
        lineNumbers: 'on',
        lineNumbersMinChars,
        lineNumbersPadding: 0,
        wordWrap: 'on',
        diffWordWrap: 'on',
        wrappingIndent: 'same',
        tabSize,
        fontSize,
        fontFamily: monacoFontFamily,
        lineHeight,
        stickyScroll: { enabled: false },
        diffAlgorithm: 'advanced',
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 2,
          minimumLineCount: 3,
          revealLineCount: 2,
        },
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontal: 'hidden',
          horizontalScrollbarSize: 0,
          useShadows: false,
        },
      });

      const originalModel = monaco.editor.createModel(original, language);
      const modifiedModel = monaco.editor.createModel(modified, language);
      diffEditor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      diffEditorRef.current = diffEditor;
      originalModelRef.current = originalModel;
      modifiedModelRef.current = modifiedModel;

      initMonacoShiki().then(() => {
        if (disposed) return;
        setHighlighterReady(true);
        monaco.editor.setTheme(getMonacoThemeName(latestRef.current.theme === 'dark'));
      });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      diffEditorRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      diffEditorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!wrapperRef.current) return undefined;

    /**
     * 同步左右编辑窗格的实际宽度，用于让顶部标签栏与 Monaco 分栏保持对齐。
     */
    const syncPaneWidths = () => {
      const root = wrapperRef.current;
      if (!root) return;
      const leftPane = root.querySelector('.editor.original');
      const rightPane = root.querySelector('.editor.modified');
      const nextLeft = leftPane?.getBoundingClientRect().width || 0;
      const nextRight = rightPane?.getBoundingClientRect().width || 0;
      if (!nextLeft || !nextRight) return;
      setPaneWidths((prev) =>
        prev.left === nextLeft && prev.right === nextRight
          ? prev
          : { left: nextLeft, right: nextRight },
      );
    };

    const frameId = requestAnimationFrame(syncPaneWidths);
    const observer = new ResizeObserver(syncPaneWidths);
    observer.observe(wrapperRef.current);

    const leftPane = wrapperRef.current.querySelector('.editor.original');
    const rightPane = wrapperRef.current.querySelector('.editor.modified');
    if (leftPane) observer.observe(leftPane);
    if (rightPane) observer.observe(rightPane);

    window.addEventListener('resize', syncPaneWidths);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('resize', syncPaneWidths);
    };
  }, [original, modified]);

  useEffect(() => {
    if (originalModelRef.current && originalModelRef.current.getValue() !== original) {
      originalModelRef.current.setValue(original);
    }
    if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== modified) {
      modifiedModelRef.current.setValue(modified);
    }
  }, [original, modified]);

  useEffect(() => {
    if (originalModelRef.current)
      monaco.editor.setModelLanguage(originalModelRef.current, language);
    if (modifiedModelRef.current)
      monaco.editor.setModelLanguage(modifiedModelRef.current, language);
  }, [language]);

  useEffect(() => {
    diffEditorRef.current?.updateOptions({
      lineNumbersMinChars,
      lineDecorationsWidth: 10,
      tabSize,
      fontSize,
      fontFamily: monacoFontFamily,
      lineHeight,
    });
  }, [lineNumbersMinChars, tabSize, fontSize, monacoFontFamily, lineHeight]);

  useEffect(() => {
    const themeName = getMonacoThemeName(theme === 'dark');
    if (highlighterReady) {
      monaco.editor.setTheme(themeName);
      return;
    }
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
  }, [theme, highlighterReady]);

  const labelStyle =
    paneWidths.left && paneWidths.right
      ? { gridTemplateColumns: `${paneWidths.left}px ${paneWidths.right}px` }
      : undefined;

  return (
    <div ref={wrapperRef} className="conflict-dialog__diff-shell">
      <div className="conflict-dialog__pane-labels" style={labelStyle} aria-hidden="true">
        <div className="conflict-dialog__pane-label conflict-dialog__pane-label--local">
          {localLabel}
        </div>
        <div className="conflict-dialog__pane-label conflict-dialog__pane-label--remote">
          {remoteLabel}
        </div>
      </div>
      <div ref={containerRef} className="conflict-dialog__monaco" />
    </div>
  );
}

