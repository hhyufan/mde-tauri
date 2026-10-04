import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useProblemsStore, { selectFileProblems } from '@store/useProblemsStore';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { jumpToProblem } from '@/services/problemNavigation';

export function ProblemIcon({ severity = 1 }) {
  return <svg className={`problems__severity problems__severity--${severity}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {severity === 1 ? <><circle cx="10" cy="10" r="7" /><path d="m7.5 7.5 5 5m0-5-5 5" /></> : severity === 2 ?
      <><path d="m10 2 8 15H2Z" /><path d="M10 7v4m0 2v1" /></> : severity === 3 ?
        <><circle cx="10" cy="10" r="7" /><path d="M10 6v5m0 2v1" /></> : <><path d="M7 14h6m-6 2h6m-5 2h4M6 10a5 5 0 1 1 8 0l-1 2H7Z" /></>}
  </svg>;
}

export default function ProblemsPanel() {
  const { t } = useTranslation();
  const state = useProblemsStore();
  const tabs = useEditorStore((state) => state.tabRenderList);
  const activeId = useEditorStore((state) => state.activeTabId);
  const active = tabs.find((tab) => tab.id === activeId);
  const { openFileFromPath } = useFileManager();
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState([1, 2, 3, 4]);
  const [selected, setSelected] = useState(null);
  const [navigationError, setNavigationError] = useState('');
  const scoped = useMemo(() => selectFileProblems(state, active), [state, active]);
  const visible = scoped.filter((problem) => levels.includes(problem.severity)
    && `${problem.message} ${problem.filePath || problem.fileName} ${problem.source || ''} ${problem.code || ''}`.toLowerCase().includes(query.toLowerCase()));
  const navigate = async (problem) => {
    setSelected(problem.id); setNavigationError('');
    try { if (!await jumpToProblem(problem, openFileFromPath)) setNavigationError(t('problems.openFailed')); }
    catch (_) { setNavigationError(t('problems.openFailed')); }
  };
  return <div className="problems" role="tabpanel" id="problems-panel" aria-labelledby="problems-tab">
    <div className="problems__toolbar">
      <div className="problems__levels">{[1, 2, 3, 4].map((severity) => <Tooltip key={severity}
        title={t(`problems.severity.${severity}`)} placement="top" mouseEnterDelay={0.3}>
        <button type="button"
          aria-label={t(`problems.severity.${severity}`)} aria-pressed={levels.includes(severity)}
          onClick={() => setLevels((current) => current.includes(severity) ? current.filter((level) => level !== severity) : [...current, severity])}>
          <ProblemIcon severity={severity} /><span>{scoped.filter((problem) => problem.severity === severity).length}</span>
        </button>
      </Tooltip>)}</div>
      <input aria-label={t('problems.filter')} placeholder={t('problems.filter')} value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <div className="problems__list" aria-label={t('problems.list')}>
      {navigationError && <div className="problems__error" role="alert">{navigationError}</div>}
      {!visible.length && <div className="problems__empty">{scoped.length ? t('problems.noMatches') : t('problems.empty')}</div>}
      {visible.map((problem) => <Tooltip key={problem.id} placement="top" mouseEnterDelay={0.3}
        title={<span className="problems__tip">
          <span>{t(`problems.severity.${problem.severity}`)} · {problem.message}</span>
          <span className="problems__tip-sub">{problem.filePath || problem.fileName}:{problem.line}:{problem.column}</span>
          <span className="problems__tip-sub">{t('problems.jumpHint')}</span>
        </span>}>
        <div role="button" tabIndex={0}
          className={`problems__row${selected === problem.id ? ' is-selected' : ''}`}
          onClick={() => setSelected(problem.id)} onDoubleClick={() => navigate(problem)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); navigate(problem); } }}>
          <ProblemIcon severity={problem.severity} /><span className="problems__message">{problem.message}</span>
          <span className="problems__source">{problem.source}{problem.code != null && ` (${problem.code})`}</span>
          <span className="problems__location">{t('problems.location', { line: problem.line, column: problem.column })}</span>
        </div>
      </Tooltip>)}
    </div>
    <div className="problems__footer"><span>{t('problems.total', { shown: visible.length, total: scoped.length })}</span><span>{t('problems.jumpHint')}</span></div>
  </div>;
}
