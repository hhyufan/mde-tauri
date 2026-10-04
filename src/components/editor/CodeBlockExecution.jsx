import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useCodeBlockRunStore, { EMPTY_BLOCK_RUN, isBlockRunning } from '@store/useCodeBlockRunStore';
import { scriptRunner } from '@/services/scriptRunner';
import { isImeComposing } from '@utils/keyboard';
import './code-block-execution.scss';

export default function CodeBlockExecution({ blockKey, language, source, filePath, fileName }) {
  const { t } = useTranslation();
  const STATUS = { preparing: t('console.status.preparing'), running: t('console.status.running'), stopping: t('console.status.stopping'), stopped: t('console.status.stopped'), success: t('console.status.success'), error: t('console.status.error') };
  const run = useCodeBlockRunStore((state) => state.blocks[blockKey] || EMPTY_BLOCK_RUN);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const pendingInput = useRef(null);
  const composing = useRef(false);
  useEffect(() => {
    pendingInput.current = null; composing.current = false; setSending(false); setInput('');
  }, [run.runId]);
  const running = isBlockRunning(run.status);
  const stale = run.runId && (run.source !== source || run.language !== language);
  const submit = async (event) => {
    event.preventDefault();
    if (composing.current || pendingInput.current) return;
    const token = { runId: run.runId };
    const submitted = input;
    pendingInput.current = token;
    setSending(true);
    try {
      if (await scriptRunner.sendBlockInput(blockKey, submitted)
        && useCodeBlockRunStore.getState().blocks[blockKey]?.runId === token.runId) {
        setInput((current) => current === submitted ? '' : current);
      }
    } finally {
      if (pendingInput.current === token) { pendingInput.current = null; setSending(false); }
    }
  };
  return <section className="md-code-execution" contentEditable={false} aria-label={t('codeBlock.label')}>
    <div className="md-code-execution__toolbar">
      <button type="button" disabled={run.status === 'stopping'}
        aria-label={running ? t('codeBlock.stopBlock') : t('codeBlock.runBlock')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => running ? scriptRunner.stopBlock(blockKey) : scriptRunner.runBlock({
          key: blockKey, language, source, filePath, fileName,
        })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          {running ? <rect x="6" y="6" width="12" height="12" rx="1" /> : <path d="m8 5 11 7-11 7z" />}
        </svg>{running ? t('console.stop') : t('console.run')}
      </button>
    </div>
    {run.runId && <div className={`md-code-execution__result is-${run.status}`}>
      <header><span><i />{STATUS[run.status]}{run.exitCode != null && ` · ${t('console.exitCode', { code: run.exitCode })}`}{run.elapsedMs > 0 && ` · ${(run.elapsedMs / 1000).toFixed(2)} s`}</span>
        <button type="button" onClick={() => useCodeBlockRunStore.getState().clear(blockKey)}>{t('codeBlock.clear')}</button>
      </header>
      {stale && <div className="md-code-execution__hint">{t('codeBlock.stale')}</div>}
      <div className="md-code-execution__output" role="log" aria-label={t('codeBlock.output')} tabIndex={0}>
        {run.truncated && <div className="md-code-execution__hint">{t('console.truncated')}</div>}
        <samp>{run.logs.map((entry, index) => <span key={index} className={`md-code-execution__${entry.kind}`}>{entry.text}</span>)}</samp>
        {!run.logs.length && <span className="md-code-execution__hint">{running ? t('console.waiting') : t('codeBlock.noOutput')}</span>}
      </div>
      {run.status === 'running' && <form onSubmit={submit}>
        <span className="md-code-execution__prompt" aria-hidden="true"><svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" /></svg></span><input aria-label={t('codeBlock.input')} value={input}
          placeholder={t('console.inputPlaceholder')} onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !composing.current && !isImeComposing(event)
              && (event.repeat || pendingInput.current)) event.preventDefault();
          }}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
        <Tooltip title={t('console.send')} placement="top" mouseEnterDelay={0.3}>
          <button type="submit" disabled={sending} aria-label={t('console.sendLabel')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
            </svg>
          </button>
        </Tooltip>
      </form>}
    </div>}
  </section>;
}
