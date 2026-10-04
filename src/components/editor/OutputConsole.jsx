import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { open } from '@tauri-apps/plugin-dialog';
import useEditorStore from '@store/useEditorStore';
import useScriptStore, { isScriptRunning } from '@store/useScriptStore';
import { getScriptLanguage, scriptRunner } from '@/services/scriptRunner';
import { isImeComposing } from '@utils/keyboard';
import { consoleAvailable } from '@utils/consoleSupport';
import useProblemsStore, { selectFileProblems } from '@store/useProblemsStore';
import ProblemsPanel, { ProblemIcon } from './ProblemsPanel';
import './output-console.scss';

// 语言名（JavaScript/Python/C#/Java/Kotlin）在中英文界面里写法一致，保持模块级常量。
const LABELS = { javascript: 'JavaScript', python: 'Python', csharp: 'C#', java: 'Java', kotlin: 'Kotlin', rust: 'Rust' };

function Icon({ type }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {type === 'run' ? <path d="m8 5 11 7-11 7z" /> : type === 'stop' ? <rect x="6" y="6" width="12" height="12" rx="1" /> :
      type === 'close' ? <path d="m6 6 12 12M18 6 6 18" /> : type === 'clear' ? <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /><path d="M10 10v7m4-7v7" /></> :
        type === 'copy' ? <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></> :
          type === 'send' ? <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></> :
            type === 'runtime' ? <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></> :
          <><path d="m5 7 5 5-5 5M13 17h6" /></>}
  </svg>;
}

export default function OutputConsole() {
  const { t } = useTranslation();
  const STATUS = { idle: t('console.status.idle'), preparing: t('console.status.preparing'), running: t('console.status.running'), stopping: t('console.status.stopping'), stopped: t('console.status.stopped'), success: t('console.status.success'), error: t('console.status.error') };
  const RUNTIME_HINTS = { csharp: t('console.runtimeHint.csharp'), java: t('console.runtimeHint.java'), kotlin: t('console.runtimeHint.kotlin'), rust: t('console.runtimeHint.rust') };
  const state = useScriptStore();
  const problemsState = useProblemsStore();
  const isOutput = state.toolTab === 'output';
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeId = useEditorStore((s) => s.activeTabId);
  const viewMode = useEditorStore((s) => s.viewMode);
  const active = tabs.find((tab) => tab.id === activeId);
  const problemCount = selectFileProblems(problemsState, active).length;
  const canRun = Boolean(getScriptLanguage(active?.name));
  const running = isScriptRunning(state.status);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const pendingInput = useRef(null);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef(null);
  const followOutput = useRef(true);
  const resize = useRef(null);
  const inputComposing = useRef(false);
  useEffect(() => {
    for (const document of Object.values(useProblemsStore.getState().documents)) {
      if (document.tabId && !document.filePath && !tabs.some((tab) => tab.id === document.tabId)) {
        useProblemsStore.getState().forgetDocument(document.key);
      }
    }
  }, [tabs]);
  useEffect(() => {
    if (state.open && followOutput.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [state.logs, state.open, state.toolTab, settingsOpen]);
  useEffect(() => {
    followOutput.current = true; inputComposing.current = false;
    pendingInput.current = null; setSending(false); setInput('');
  }, [state.runId]);
  useEffect(() => {
    const shortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isImeComposing(event)) return;
      if (!event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault(); event.stopPropagation(); const current = useScriptStore.getState();
        // 没有代码编辑器或语言不受支持时，快捷键不产生任何效果，避免在
        // 后续切换到支持的文件时突然弹出控制台。
        const editor = useEditorStore.getState();
        const activeTab = editor.tabRenderList.find((tab) => tab.id === editor.activeTabId);
        if (consoleAvailable(editor.viewMode, activeTab)) current.setOpen(!current.open);
      } else if (event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault(); event.stopPropagation();
        const editor = useEditorStore.getState();
        const activeTab = editor.tabRenderList.find((tab) => tab.id === editor.activeTabId);
        if (consoleAvailable(editor.viewMode, activeTab)) useScriptStore.getState().setToolTab('problems');
      }
    };
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  }, []);
  // 控制台不再常驻编辑器底部：关闭时整块面板（含折叠工具条）都隐藏，
  // 需要时通过标签栏按钮或 Ctrl+J / Ctrl+Shift+M 呼出。组件保持挂载，
  // 以便快捷键和问题文档清理逻辑在收起状态下继续生效。
  if (!state.open || !consoleAvailable(viewMode, active)) return null;
  const selectTool = (tab) => {
    if (state.toolTab === tab) state.setOpen(false);
    else state.setToolTab(tab);
  };

  const browse = async (language) => {
    try {
      const selected = await open({ multiple: false, title: t('console.chooseRuntime', { language: LABELS[language] }), filters: [{ name: t('console.executableFilter'), extensions: ['exe', '*'] }] });
      if (typeof selected === 'string') state.setRuntimePath(language, selected);
    } catch (error) { state.append('stderr', `${error?.message || error}\n`); }
  };
  const send = async (event) => {
    event.preventDefault();
    if (inputComposing.current || pendingInput.current) return;
    const token = { runId: state.runId };
    const submitted = input;
    pendingInput.current = token;
    setSending(true);
    try {
      if (await scriptRunner.sendInput(submitted) && useScriptStore.getState().runId === token.runId) {
        // IPC 等待期间输入的下一条内容不能被上一条提交清空。
        setInput((current) => current === submitted ? '' : current);
      }
    } finally {
      if (pendingInput.current === token) { pendingInput.current = null; setSending(false); }
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.logs.map((entry) => entry.text).join(''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) { state.append('stderr', `${t('console.copyFailed', { error: error?.message || error })}\n`); }
  };
  return <React.Fragment>
    <section className="output-console" aria-label={t('console.aria.label')} style={{ height: state.height }}>
      <div className="output-console__resize" role="separator" aria-label={t('console.aria.resize')}
        aria-orientation="horizontal" aria-valuemin={140} aria-valuemax={600} aria-valuenow={state.height} tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault(); state.setHeight(state.height + (event.key === 'ArrowUp' ? 20 : -20));
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          resize.current = { y: event.clientY, height: state.height };
          event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (resize.current) state.setHeight(Math.min(window.innerHeight * 0.65, resize.current.height + resize.current.y - event.clientY));
        }}
        onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }} />
      <header className="output-console__header">
        <div className="output-console__tabs" role="tablist" aria-label={t('console.aria.tools')}>
          <button type="button" role="tab" id="output-tab" aria-controls="output-panel" aria-selected={isOutput}
            onClick={() => selectTool('output')}><Icon type="console" /><span>{t('console.title')}</span></button>
          <button type="button" role="tab" id="problems-tab" aria-controls="problems-panel" aria-selected={!isOutput}
            onClick={() => selectTool('problems')}><ProblemIcon severity={2} /><span>{t('problems.title')}</span><span className="output-console__badge">{problemCount}</span></button>
        </div>
        <div className="output-console__actions">
          {isOutput && <>
          <Tooltip title={t('console.runtime')} placement="top" mouseEnterDelay={0.3}>
            <button className={settingsOpen ? 'is-active' : ''} onClick={() => setSettingsOpen(!settingsOpen)}
              aria-expanded={settingsOpen} aria-label={t('console.runtime')}><Icon type="runtime" /></button>
          </Tooltip>
          <Tooltip title={t('console.runCurrentHint')} placement="top" mouseEnterDelay={0.3}>
            <button aria-label={t('console.runCurrent')} disabled={running || !canRun} onClick={() => scriptRunner.runCurrent()}><Icon type="run" /></button>
          </Tooltip>
          <Tooltip title={t('console.stopCurrentHint')} placement="top" mouseEnterDelay={0.3}>
            <button aria-label={t('console.stopCurrent')} disabled={!running || state.status === 'stopping'} onClick={() => scriptRunner.stop()}><Icon type="stop" /></button>
          </Tooltip>
          <Tooltip title={copied ? t('console.copied') : t('console.copy')} placement="top" mouseEnterDelay={0.3}>
            <button aria-label={copied ? t('console.copied') : t('console.copy')} onClick={copy}><Icon type="copy" /></button>
          </Tooltip>
          <Tooltip title={t('console.clear')} placement="top" mouseEnterDelay={0.3}>
            <button aria-label={t('console.clear')} onClick={state.clear}><Icon type="clear" /></button>
          </Tooltip>
          </>}
          <Tooltip title={t('console.hide')} placement="top" mouseEnterDelay={0.3}>
            <button aria-label={t('console.hide')} onClick={() => { inputComposing.current = false; state.setOpen(false); }}><Icon type="close" /></button>
          </Tooltip>
        </div>
      </header>
      {!isOutput && <ProblemsPanel />}
      {isOutput && settingsOpen && <div className="output-console__settings" id="output-panel" role="tabpanel" aria-labelledby="output-tab">
        {Object.entries(LABELS).map(([language, label]) => <label key={language}>
          <span>{label}</span><input aria-label={t('console.runtimePath', { language: label })} value={state.runtimePaths[language] || ''}
            placeholder={RUNTIME_HINTS[language] || t('console.runtimeHint.default')}
            onChange={(event) => state.setRuntimePath(language, event.target.value)} />
          <button onClick={() => browse(language)}>{t('console.browse')}</button>
        </label>)}
      </div>}
      {/* 展开“运行环境”时输出区让位给设置面板，控制台高度不足时也不会溢出到底部状态栏上。 */}
      {isOutput && !settingsOpen && <div className="output-console__body" id="output-panel" role="tabpanel" aria-labelledby="output-tab" ref={outputRef} tabIndex={0} aria-label={t('console.aria.output')}
        onScroll={(event) => { const el = event.currentTarget; followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {state.truncated && <div className="output-console__muted">{t('console.truncated')}</div>}
        {!state.logs.length && <div className="output-console__empty">{running ? t('console.waiting') : t('console.emptyHint')}</div>}
        <samp className="output-console__text">{state.logs.map((entry, index) => <span key={index} className={`output-console__${entry.kind}`}>{entry.text}</span>)}</samp>
      </div>}
      {isOutput && <footer className="output-console__footer">
        <span>{state.status === 'idle' ? t('console.localRun') : `${STATUS[state.status]}${state.exitCode != null ? ` · ${t('console.exitCode', { code: state.exitCode })}` : ''}${state.elapsedMs ? ` · ${(state.elapsedMs / 1000).toFixed(2)} s` : ''}`}</span>
        {state.status === 'running' && <form onSubmit={send}>
          <span className="output-console__prompt" aria-hidden="true"><svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" /></svg></span><input aria-label={t('console.aria.input')} value={input} disabled={state.status !== 'running'}
            placeholder={t('console.inputPlaceholder')} onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !inputComposing.current && !isImeComposing(event)
                && (event.repeat || pendingInput.current)) event.preventDefault();
            }}
            onCompositionStart={() => { inputComposing.current = true; }}
            onCompositionEnd={() => { inputComposing.current = false; }} />
          <Tooltip title={t('console.send')} placement="top" mouseEnterDelay={0.3}>
            <button disabled={sending} type="submit" aria-label={t('console.sendLabel')}><Icon type="send" /></button>
          </Tooltip>
        </form>}
      </footer>}
    </section>
  </React.Fragment>;
}
