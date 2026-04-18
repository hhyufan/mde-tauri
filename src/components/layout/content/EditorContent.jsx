import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import MonacoEditor from '@components/editor/LazyMonacoEditor';
import MarkdownPreview from '@components/editor/MarkdownPreview';
import FloatingToolbar from '@components/editor/FloatingToolbar';
import ToastContainer from '@components/ui/Toast';
import { useFileManager } from '@hooks/useFileManager';
import './editor-content.scss';

function EditorContent() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((s) => s.getActiveTab());
  const viewMode = useEditorStore((s) => s.viewMode);
  const monacoRef = useRef(null);
  const { triggerAutoSave } = useFileManager();

  const handleToolbarInsert = useCallback((action) => {
    const editor = monacoRef.current;
    if (!editor) return;

    if (action.type === 'insert') {
      editor.insertText(action.text);
    } else if (action.type === 'wrap') {
      editor.wrapSelection(action.before, action.after);
    }
  }, []);

  if (!activeTab) {
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

  const isMarkdown = /\.(md|markdown|mdx)$/i.test(activeTab.name);

  return (
    <main className="editor-content">
      <ToastContainer />
      <div className="editor-content__workspace">
        {viewMode === 'edit' && (
          <MonacoEditor ref={monacoRef} className="editor-content__editor" onAutoSave={triggerAutoSave} />
        )}
        {viewMode === 'preview' && isMarkdown && (
          <MarkdownPreview className="editor-content__preview" />
        )}
        {viewMode === 'split' && isMarkdown && (
          <>
            <MonacoEditor ref={monacoRef} className="editor-content__editor editor-content__editor--half" onAutoSave={triggerAutoSave} />
            <div className="editor-content__split-divider" />
            <MarkdownPreview className="editor-content__preview editor-content__preview--half" />
          </>
        )}
        {!isMarkdown && viewMode !== 'edit' && (
          <MonacoEditor ref={monacoRef} className="editor-content__editor" onAutoSave={triggerAutoSave} />
        )}
      </div>

      {/* FloatingToolbar is outside workspace to avoid overflow:hidden clipping */}
      {isMarkdown && viewMode !== 'preview' && (
        <FloatingToolbar onInsert={handleToolbarInsert} />
      )}
    </main>
  );
}

export default EditorContent;
