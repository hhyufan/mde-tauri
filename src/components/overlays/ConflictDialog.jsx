/**
 * 冲突处理弹窗模块。
 *
 * 提供同步冲突场景下的可视化差异比较与决策入口，负责组织 Monaco Diff
 * Editor、冲突元数据展示，以及保留本地或采用远端版本的动作触发。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Space } from 'antd';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, isMonacoShikiReady, getMonacoThemeName } from '@utils/monacoShiki';
import './conflict-dialog.scss';

/**
 * 统计文本行数，为差异编辑器动态计算行号列宽提供依据。
 *
 * @param {string} content 待统计的文本内容。
 * @returns {number} 文本行数，空内容至少返回 1。
 */
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

/**
 * 同步冲突弹窗。
 *
 * 每次展示一个冲突条目，并提供“保留本地”与“使用远端”两种显式决策入口。
 *
 * @param {object} props 组件属性。
 * @param {boolean} props.open 控制弹窗显示状态。
 * @param {Array<object>} props.conflicts 待处理的冲突列表。
 * @param {(fileId: string, decision: 'local' | 'remote') => void} props.onResolve 处理冲突决策的回调。
 * @param {() => void} props.onClose 关闭弹窗的回调。
 */
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
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1180px, 94vw)"
      centered
      closable={false}
      maskClosable={false}
      destroyOnHidden
      rootClassName="mde-conflict-modal-root"
      styles={{ body: { padding: 0 }, content: { padding: 0 } }}
    >
      <div className="conflict-dialog">
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
          <Space>
            <Button onClick={() => onResolve(current.fileId, 'local')}>
              {t('sync.conflict.keepLocal')}
            </Button>
            <Button type="primary" onClick={() => onResolve(current.fileId, 'remote')}>
              {t('sync.conflict.useRemote')}
            </Button>
          </Space>
        </div>
      </div>
    </Modal>
  );
}

export default ConflictDialog;
