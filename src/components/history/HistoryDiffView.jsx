import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from 'antd';
import { CheckOutlined, CloseOutlined, HistoryOutlined, UndoOutlined } from '@ant-design/icons';
import * as monaco from 'monaco-editor';
import useHistoryStore from '@store/useHistoryStore';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { useFileManager } from '@hooks/useFileManager';
import { getBuffer } from '@utils/editorBuffer';
import { historyCapture } from '@utils/tauriApi';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, getMonacoThemeName } from '@utils/monacoShiki';
import { restoreSelectedHistoryChanges } from '@utils/historyChanges';
import './history.scss';

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function MonacoHistoryDiff({
  original,
  modified,
  fileName,
  theme,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  busy,
  noChanges,
  onDraftChange,
  onSelectionReady,
  onSplitChange,
  apiRef,
}) {
  const containerRef = useRef(null);
  const diffRef = useRef(null);
  const originalModelRef = useRef(null);
  const modifiedModelRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const updatingRef = useRef(false);
  const latestRef = useRef(null);

  const language = useMemo(() => getFileLanguage(fileName || ''), [fileName]);
  const mono = useMemo(() => `'${fontFamily}', 'Fira Code', Consolas, monospace`, [fontFamily]);
  latestRef.current = {
    original,
    modified,
    language,
    theme,
    fontSize,
    mono,
    lineHeight,
    tabSize,
    busy,
    onDraftChange,
    onSelectionReady,
    onSplitChange,
  };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;
    const listeners = [];
    initMonacoShiki()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const props = latestRef.current;
        const diff = monaco.editor.createDiffEditor(containerRef.current, {
          theme: getMonacoThemeName(props.theme === 'dark'),
          automaticLayout: true,
          readOnly: props.busy,
          originalEditable: false,
          renderSideBySide: true,
          useInlineViewWhenSpaceIsLimited: false,
          renderOverviewRuler: false,
          overviewRulerBorder: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          glyphMargin: true,
          renderMarginRevertIcon: true,
          renderGutterMenu: false,
          folding: false,
          lineNumbers: 'on',
          wordWrap: 'on',
          tabSize: props.tabSize,
          fontSize: props.fontSize,
          fontFamily: props.mono,
          lineHeight: props.lineHeight,
          diffAlgorithm: 'advanced',
          ignoreTrimWhitespace: false,
          hideUnchangedRegions: {
            enabled: true,
            contextLineCount: 3,
            minimumLineCount: 3,
            revealLineCount: 2,
          },
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
        });
        diffRef.current = diff;
        const originalModel = monaco.editor.createModel(props.original, props.language);
        originalModelRef.current = originalModel;
        const modifiedModel = monaco.editor.createModel(props.modified, props.language);
        modifiedModelRef.current = modifiedModel;
        const originalEditor = diff.getOriginalEditor(),
          modifiedEditor = diff.getModifiedEditor();
        const updateSplit = () => {
          if (cancelled || !containerRef.current) return;
          const offset =
            modifiedEditor.getContainerDomNode().getBoundingClientRect().left -
            containerRef.current.getBoundingClientRect().left;
          if (offset > 0) latestRef.current.onSplitChange(offset);
        };
        listeners.push(originalEditor.onDidLayoutChange(updateSplit));
        listeners.push(modifiedEditor.onDidLayoutChange(updateSplit));
        let side = 'modified',
          computedVersion = -1;
        listeners.push(
          originalEditor.onDidFocusEditorText(() => {
            side = 'original';
          }),
        );
        listeners.push(
          modifiedEditor.onDidFocusEditorText(() => {
            side = 'modified';
          }),
        );
        listeners.push(
          originalModel.onDidChangeContent(() => latestRef.current.onSelectionReady(false)),
        );
        listeners.push(
          modifiedModel.onDidChangeContent(() => {
            latestRef.current.onSelectionReady(false);
            if (!updatingRef.current) latestRef.current.onDraftChange(modifiedModel.getValue());
          }),
        );
        listeners.push(
          diff.onDidUpdateDiff(() => {
            computedVersion = modifiedModel.getVersionId();
            latestRef.current.onSelectionReady(Boolean(diff.getLineChanges()?.length));
          }),
        );
        apiRef.current = {
          restoreSelection: () => {
            if (latestRef.current.busy || computedVersion !== modifiedModel.getVersionId()) return;
            const selection = (
              side === 'original' ? originalEditor : modifiedEditor
            ).getSelection();
            const content = restoreSelectedHistoryChanges(
              originalModel.getValue(),
              modifiedModel.getValue(),
              diff.getLineChanges(),
              selection,
              side,
            );
            if (content === modifiedModel.getValue()) return;
            modifiedEditor.pushUndoStop();
            modifiedEditor.executeEdits('history-selection', [
              { range: modifiedModel.getFullModelRange(), text: content },
            ]);
            modifiedEditor.pushUndoStop();
          },
        };
        diff.setModel({ original: originalModel, modified: modifiedModel });
        updateSplit();
        setReady(true);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure?.message || failure));
      });

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.dispose());
      apiRef.current = null;
      diffRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      diffRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updatingRef.current = true;
    try {
      if (originalModelRef.current && originalModelRef.current.getValue() !== original)
        originalModelRef.current.setValue(original);
      if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== modified)
        modifiedModelRef.current.setValue(modified);
    } finally {
      updatingRef.current = false;
    }
  }, [original, modified]);

  useEffect(() => {
    if (originalModelRef.current)
      monaco.editor.setModelLanguage(originalModelRef.current, language);
    if (modifiedModelRef.current)
      monaco.editor.setModelLanguage(modifiedModelRef.current, language);
  }, [language]);

  useEffect(() => {
    if (diffRef.current) monaco.editor.setTheme(getMonacoThemeName(theme === 'dark'));
    diffRef.current?.updateOptions({
      readOnly: busy,
      fontSize,
      fontFamily: mono,
      lineHeight,
      tabSize,
    });
  }, [theme, busy, fontSize, mono, lineHeight, tabSize]);

  return (
    <>
      {error && (
        <div className="history-diff__error" role="alert">
          {error}
        </div>
      )}
      <div
        className="history-diff__editor"
        ref={containerRef}
        data-ready={ready}
        hidden={noChanges}
      />
    </>
  );
}

/**
 * 主编辑区的历史对比视图（VS Code 式：diff 覆盖编辑区，关闭后回到正文）。
 *
 * 左侧 = 历史版本，右侧 = 当前内容；顶部横栏提供「关闭对比」与「恢复此版本」。
 */
export default function HistoryDiffView() {
  const { t } = useTranslation();
  const diff = useHistoryStore((s) => s.diff);
  const clearDiff = useHistoryStore((s) => s.clearDiff);
  const tabs = useEditorStore((s) => s.tabs);
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const fontFamily = useConfigStore((s) => s.fontFamily);
  const lineHeight = useConfigStore((s) => s.lineHeight);
  const tabSize = useConfigStore((s) => s.tabSize);
  const { saveTab } = useFileManager();

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [selectionReady, setSelectionReady] = useState(false);
  const [historyHash, setHistoryHash] = useState(null);
  const [splitOffset, setSplitOffset] = useState(null);
  const editorRef = useRef(null);

  const tab = tabs.find((item) => item.id === diff?.tabId) || null;
  useEffect(() => {
    setDraft(null);
    setSelectionReady(false);
  }, [diff?.timestamp, tab?.id]);
  const historyContent = diff?.content;
  useEffect(() => {
    if (historyContent == null) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(historyContent)))
      .then((digest) => {
        if (cancelled) return;
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        setHistoryHash({ content: historyContent, hash });
      })
      .catch((error) => console.warn('[history] hash failed:', error));
    return () => {
      cancelled = true;
    };
  }, [historyContent]);
  if (!diff || !tab) return null;

  const current = getBuffer(tab.id, tab.content || '');
  const modified = draft ?? current;
  // Monaco 按行比较，不把 CRLF/LF 的差别当成代码修改。
  const noChanges = diff.content.replace(/\r\n|\r/g, '\n') === modified.replace(/\r\n|\r/g, '\n');
  const hash = historyHash?.content === diff.content ? historyHash.hash : '';

  const saveChanges = async (content, rollback = false) => {
    setBusy(true);
    try {
      // 先把当前内容存为快照，保证恢复可逆。
      await historyCapture(tab.path, getBuffer(tab.id, tab.content || ''));
      useEditorStore.getState().replaceTabContent(tab.id, { content });
      useEditorStore.getState().markTabDirty(tab.id);
      const result = await saveTab(tab.id);
      if (!result?.ok) return;
      // 应用修改也保存历史；只有整版回滚附带回滚来源标记。
      await historyCapture(tab.path, content, {
        force: true,
        ...(rollback ? { restoredFrom: diff.timestamp } : {}),
      });
      clearDiff();
    } catch (error) {
      console.warn('[history] restore failed:', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="history-diff">
      <header className="history-diff__bar">
        <span className="history-diff__title">{t('history.title')}</span>
        <div className="history-diff__actions">
          <Tooltip title={t('history.closeDiff')} placement="top" mouseEnterDelay={0.3}>
            <span className="history-diff__action">
              <Button
                size="small"
                aria-label={t('history.closeDiff')}
                icon={<CloseOutlined aria-hidden="true" />}
                disabled={busy}
                onClick={clearDiff}
              />
            </span>
          </Tooltip>
          <Tooltip title={t('history.restoreSelection')} placement="top" mouseEnterDelay={0.3}>
            <span className="history-diff__action">
              <Button
                size="small"
                aria-label={t('history.restoreSelection')}
                icon={<UndoOutlined aria-hidden="true" />}
                disabled={busy || noChanges || !selectionReady}
                onClick={() => editorRef.current?.restoreSelection()}
              />
            </span>
          </Tooltip>
          <Tooltip title={t('history.applyChanges')} placement="top" mouseEnterDelay={0.3}>
            <span className="history-diff__action">
              <Button
                type="primary"
                size="small"
                aria-label={t('history.applyChanges')}
                icon={<CheckOutlined aria-hidden="true" />}
                disabled={busy || draft == null || draft === current}
                onClick={() => saveChanges(draft)}
              />
            </span>
          </Tooltip>
          <Tooltip title={t('history.restore')} placement="top" mouseEnterDelay={0.3}>
            <span className="history-diff__action">
              <Button
                size="small"
                aria-label={t('history.restore')}
                icon={<HistoryOutlined aria-hidden="true" />}
                disabled={busy}
                onClick={() => saveChanges(diff.content, true)}
              />
            </span>
          </Tooltip>
        </div>
      </header>
      <div
        className="history-diff__files"
        style={{ '--history-split': splitOffset == null ? '50%' : `${splitOffset}px` }}
      >
        <div className="history-diff__file" role="group" aria-label={t('history.title')}>
          <span className="history-diff__filename">{tab.name}</span>
          {hash && (
            <Tooltip title={`SHA-256: ${hash}`} placement="top" mouseEnterDelay={0.3}>
              <code className="history-diff__hash">{hash.slice(0, 8)}</code>
            </Tooltip>
          )}
          <time dateTime={new Date(diff.timestamp).toISOString()}>
            {formatTime(diff.timestamp)}
          </time>
        </div>
        <div className="history-diff__file" role="group" aria-label={t('history.current')}>
          <span className="history-diff__filename">{tab.name}</span>
          <span className="history-diff__version">{t('history.current')}</span>
        </div>
      </div>
      {noChanges && (
        <div className="history-diff__empty" role="status">
          {t('history.noChanges')}
        </div>
      )}
      <MonacoHistoryDiff
        original={diff.content}
        modified={modified}
        fileName={tab.name}
        theme={theme}
        fontSize={fontSize}
        fontFamily={fontFamily}
        lineHeight={lineHeight}
        tabSize={tabSize}
        busy={busy}
        noChanges={noChanges}
        onDraftChange={setDraft}
        onSelectionReady={setSelectionReady}
        onSplitChange={setSplitOffset}
        apiRef={editorRef}
      />
    </div>
  );
}
