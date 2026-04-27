import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import MonacoEditor from '@components/editor/LazyMonacoEditor';
import MarkdownPreview from '@components/editor/MarkdownPreview';
import FloatingToolbar from '@components/editor/FloatingToolbar';
import ToastContainer from '@components/ui/Toast';
import { useFileManager } from '@hooks/useFileManager';
import './editor-content.scss';

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 24;

function clampFontSize(value) {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
}

function getNextTypography(delta) {
  const { fontSize, lineHeight } = useConfigStore.getState();
  const currentFontSize = fontSize || DEFAULT_FONT_SIZE;
  const nextFontSize = clampFontSize(currentFontSize + delta);
  const currentLineHeight = lineHeight || DEFAULT_LINE_HEIGHT;
  const lineHeightRatio = currentLineHeight / currentFontSize;

  return {
    fontSize: nextFontSize,
    lineHeight: Math.round(nextFontSize * lineHeightRatio),
  };
}

function EditorContent() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const viewMode = useEditorStore((s) => s.viewMode);
  const monacoRef = useRef(null);
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const setConfig = useConfigStore((s) => s.setConfig);
  const { triggerAutoSave } = useFileManager();
  const activeTabMeta = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );

  const handleToolbarInsert = useCallback((action) => {
    const editor = monacoRef.current;
    if (!editor) return;

    if (action.type === 'insert') {
      editor.insertText(action.text);
    } else if (action.type === 'wrap') {
      editor.wrapSelection(action.before, action.after);
    }
  }, []);

  const handleDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvt) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (moveEvt.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(0.15, Math.min(0.85, ratio)));
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;

      event.preventDefault();
      event.stopPropagation();
      const step = event.deltaY > 0 ? -1 : 1;
      const next = getNextTypography(step);
      setConfig('fontSize', next.fontSize);
      setConfig('lineHeight', next.lineHeight);
    };

    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => container.removeEventListener('wheel', handleWheel, { capture: true });
  }, [activeTabId, setConfig]);

  if (!activeTabMeta) {
    return (
      <main className="editor-content">
        <div className="editor-content__empty">
          <div className="editor-content__empty-logo">M</div>
          <div className="editor-content__empty-title">{t('editor.empty.title')}</div>
          <div className="editor-content__empty-hint">{t('editor.empty.hint')}</div>
        </div>
      </main>
    );
  }

  const isMarkdown = /\.(md|markdown|mdx)$/i.test(activeTabMeta.name);

  return (
    <main className="editor-content">
      <ToastContainer />
      <div
        className="editor-content__workspace"
        ref={containerRef}
        style={viewMode === 'split' ? { '--split-ratio': `${splitRatio * 100}%` } : undefined}
      >
        {viewMode === 'edit' && (
          <MonacoEditor
            key={activeTabId}
            ref={monacoRef}
            className="editor-content__editor"
            onAutoSave={triggerAutoSave}
          />
        )}
        {viewMode === 'preview' && isMarkdown && (
          <MarkdownPreview className="editor-content__preview" />
        )}
        {viewMode === 'split' && isMarkdown && (
          <>
            <MonacoEditor
              key={`${activeTabId}-split`}
              ref={monacoRef}
              className="editor-content__editor editor-content__editor--half"
              onAutoSave={triggerAutoSave}
            />
            <Tooltip title={t('editor.splitDivider')} placement="top" mouseEnterDelay={0.5}>
              <div
                className="editor-content__split-divider"
                onMouseDown={handleDividerMouseDown}
              />
            </Tooltip>
            <MarkdownPreview className="editor-content__preview editor-content__preview--half" />
          </>
        )}
        {!isMarkdown && viewMode !== 'edit' && (
          <MonacoEditor
            key={`${activeTabId}-fallback`}
            ref={monacoRef}
            className="editor-content__editor"
            onAutoSave={triggerAutoSave}
          />
        )}

        <div className="editor-content__fade" />
      </div>

      {/* FloatingToolbar is outside workspace to avoid overflow:hidden clipping */}
      {isMarkdown && viewMode !== 'preview' && (
        <FloatingToolbar onInsert={handleToolbarInsert} />
      )}
    </main>
  );
}

export default EditorContent;
