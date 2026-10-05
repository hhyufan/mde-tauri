import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import * as monaco from 'monaco-editor';
import useHistoryStore from '@store/useHistoryStore';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { useFileManager } from '@hooks/useFileManager';
import { getBuffer } from '@utils/editorBuffer';
import { historyCapture } from '@utils/tauriApi';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, isMonacoShikiReady, getMonacoThemeName } from '@utils/monacoShiki';
import './history.scss';

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function MonacoHistoryDiff({ original, modified, fileName, theme, fontSize, fontFamily, lineHeight, tabSize }) {
  const containerRef = useRef(null);
  const diffRef = useRef(null);
  const originalModelRef = useRef(null);
  const modifiedModelRef = useRef(null);
  const [ready, setReady] = useState(isMonacoShikiReady());

  const language = useMemo(() => getFileLanguage(fileName || ''), [fileName]);
  const mono = useMemo(() => `'${fontFamily}', 'Fira Code', Consolas, monospace`, [fontFamily]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const diff = monaco.editor.createDiffEditor(containerRef.current, {
      theme: getMonacoThemeName(theme === 'dark'),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: false,
      overviewRulerBorder: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      glyphMargin: false,
      folding: false,
      lineNumbers: 'on',
      wordWrap: 'on',
      tabSize,
      fontSize,
      fontFamily: mono,
      lineHeight,
      diffAlgorithm: 'advanced',
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 2 },
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
    });
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    diff.setModel({ original: originalModel, modified: modifiedModel });
    diffRef.current = diff;
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;

    initMonacoShiki().then(() => {
      setReady(true);
      monaco.editor.setTheme(getMonacoThemeName(theme === 'dark'));
    });

    return () => {
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
    if (originalModelRef.current) originalModelRef.current.setValue(original);
    if (modifiedModelRef.current) modifiedModelRef.current.setValue(modified);
  }, [original, modified]);

  useEffect(() => {
    if (originalModelRef.current) monaco.editor.setModelLanguage(originalModelRef.current, language);
    if (modifiedModelRef.current) monaco.editor.setModelLanguage(modifiedModelRef.current, language);
  }, [language]);

  useEffect(() => {
    monaco.editor.setTheme(getMonacoThemeName(theme === 'dark'));
  }, [theme]);

  return <div className="history-diff__editor" ref={containerRef} data-ready={ready} />;
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
  const { saveCurrentFile } = useFileManager();

  const [busy, setBusy] = useState(false);

  const tab = tabs.find((item) => item.id === diff?.tabId) || null;
  if (!diff || !tab) return null;

  const current = getBuffer(tab.id, tab.content || '');

  const restore = async () => {
    setBusy(true);
    try {
      // 先把当前内容存为快照，保证恢复可逆。
      await historyCapture(tab.path, current);
      useEditorStore.getState().replaceTabContent(tab.id, { content: diff.content });
      useEditorStore.getState().markTabDirty(tab.id);
      await saveCurrentFile();
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
        <span className="history-diff__title">
          {t('history.title')} · {tab.name}
          <small>{formatTime(diff.timestamp)}</small>
        </span>
        <div className="history-diff__actions">
          <Button size="small" disabled={busy} onClick={clearDiff}>{t('history.closeDiff')}</Button>
          <Button type="primary" size="small" disabled={busy} onClick={restore}>{t('history.restore')}</Button>
        </div>
      </header>
      <MonacoHistoryDiff
        original={diff.content}
        modified={current}
        fileName={tab.name}
        theme={theme}
        fontSize={fontSize}
        fontFamily={fontFamily}
        lineHeight={lineHeight}
        tabSize={tabSize}
      />
    </div>
  );
}
