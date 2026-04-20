import { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import { useTranslation } from 'react-i18next';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, isMonacoShikiReady, getMonacoThemeName } from '@utils/monacoShiki';
import './conflict-dialog.scss';

function countLines(content = '') {
  if (!content) return 1;
  return content.split('\n').length;
}

function MonacoConflictDiff({
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

  useEffect(() => {
    if (!containerRef.current) return undefined;

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
        horizontalScrollbarSize: 6,
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
      setHighlighterReady(true);
      monaco.editor.setTheme(getMonacoThemeName(theme === 'dark'));
    });

    return () => {
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

    const syncPaneWidths = () => {
      const root = wrapperRef.current;
      if (!root) return;
      const leftPane = root.querySelector('.editor.original');
      const rightPane = root.querySelector('.editor.modified');
      const nextLeft = leftPane?.getBoundingClientRect().width || 0;
      const nextRight = rightPane?.getBoundingClientRect().width || 0;
      if (!nextLeft || !nextRight) return;
      setPaneWidths((prev) => (
        prev.left === nextLeft && prev.right === nextRight
          ? prev
          : { left: nextLeft, right: nextRight }
      ));
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
    if (originalModelRef.current) monaco.editor.setModelLanguage(originalModelRef.current, language);
    if (modifiedModelRef.current) monaco.editor.setModelLanguage(modifiedModelRef.current, language);
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

  const labelStyle = paneWidths.left && paneWidths.right
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

function ConflictDialog({ open, conflicts, onResolve, onClose }) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const fontFamily = useConfigStore((s) => s.fontFamily);
  const lineHeight = useConfigStore((s) => s.lineHeight);
  const tabSize = useConfigStore((s) => s.tabSize);
  if (!open || !conflicts?.length) return null;

  const current = conflicts[0];
  const localContent = current.localContent || '';
  const remoteContent = current.remoteContent || '';
  const pathLabel = current.path || current.name || current.fileId;

  return (
    <div className="conflict-overlay" onClick={onClose}>
      <div className="conflict-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="conflict-dialog__header">
          <div className="conflict-dialog__title-wrap">
            <span className="conflict-dialog__eyebrow">Sync Conflict</span>
            <h2>{t('sync.conflict.title')}</h2>
            <p className="conflict-dialog__path">{pathLabel}</p>
          </div>
          <div className="conflict-dialog__header-right">
            <span className="conflict-dialog__hint">仅显示变更及上下文</span>
          </div>
        </div>

        <div className="conflict-dialog__diff">
          <MonacoConflictDiff
            original={localContent}
            modified={remoteContent}
            fileName={current.name || current.path || ''}
            localLabel={t('sync.conflict.local')}
            remoteLabel={t('sync.conflict.remote')}
            theme={theme}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lineHeight={lineHeight}
            tabSize={tabSize}
          />
        </div>

        <div className="conflict-dialog__actions">
          <button className="conflict-dialog__btn" onClick={() => onResolve(current.fileId, 'local')}>
            {t('sync.conflict.keepLocal')}
          </button>
          <button className="conflict-dialog__btn conflict-dialog__btn--primary" onClick={() => onResolve(current.fileId, 'remote')}>
            {t('sync.conflict.useRemote')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConflictDialog;
