import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Tooltip } from 'antd';
import { SearchOutlined, CloseOutlined, LoadingOutlined, FontSizeOutlined, FolderOpenOutlined, EnterOutlined } from '@ant-design/icons';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import useWorkspaceSearch from '@hooks/useWorkspaceSearch';
import { useFileManager } from '@hooks/useFileManager';
import useEditorStore from '@store/useEditorStore';
import { jumpToProblem } from '@/services/problemNavigation';
import { isImeComposing } from '@utils/keyboard';
import { relativeSearchPath, searchPathKey, textSearchRange } from '@utils/searchMatching';
import './search-dropdown.scss';

function Highlight({ text = '', query, caseSensitive }) {
  const match = textSearchRange(text, query.trim(), caseSensitive);
  return match ? <>{text.slice(0, match.start)}<mark>{text.slice(match.start, match.start + match.length)}</mark>{text.slice(match.start + match.length)}</> : text;
}

export default function SearchDropdown({ open, onOpen, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('files');
  const [scope, setScope] = useState('project');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const inputRef = useRef(null), rootRef = useRef(null), listRef = useRef(null), previousFocus = useRef(null);
  const alive = useRef(true);
  const listId = useId();
  const { openFileFromPath } = useFileManager();
  const search = useWorkspaceSearch({ open, query, mode, scope, caseSensitive, includeExcluded });
  const results = search.results;
  const selected = Math.min(selectedIndex, Math.max(0, results.length - 1));

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    inputRef.current?.focus(); inputRef.current?.select();
    const outside = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      // antd 弹层 portal 到 body：点击其中的选项属于面板内交互，不应关闭搜索。
      if (event.target instanceof Element && event.target.closest('.ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown')) return;
      onClose();
    };
    const shortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p' && !isImeComposing(event)) {
        event.preventDefault(); inputRef.current?.focus(); inputRef.current?.select();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', shortcut);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', shortcut); };
  }, [open, onClose]);
  useEffect(() => { setSelectedIndex(0); setOpenError(''); }, [query, mode, scope, caseSensitive, includeExcluded]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);

  const closeWithFocus = () => { onClose(); inputRef.current?.blur(); previousFocus.current?.focus?.(); };
  const select = async (item) => {
    if (!item || opening) return;
    setOpening(true); setOpenError('');
    try {
      if (item.line_number != null) {
        const line = item.line_number - 1, character = (item.column_number || 1) - 1;
        const ok = await jumpToProblem({ tabId: item.tabId, filePath: item.path, fileName: item.name,
          range: { start: { line, character }, end: { line, character: character + (item.match_length || 0) } } }, openFileFromPath);
        if (!ok) throw new Error(t('search.openFailed'));
      } else {
        const existing = useEditorStore.getState().tabs.find((tab) => tab.id === item.tabId || Boolean(item.path && searchPathKey(tab.path) === searchPathKey(item.path)));
        if (existing) useEditorStore.getState().setActiveTab(existing.id);
        else {
          await openFileFromPath(item.path, item.name);
          if (!useEditorStore.getState().getTabByPath(item.path)) throw new Error(t('search.openFailed'));
        }
      }
      if (alive.current) onClose();
    } catch (error) { if (alive.current) setOpenError(String(error)); }
    finally { if (alive.current) setOpening(false); }
  };
  const keyDown = (event) => {
    if (isImeComposing(event)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeWithFocus(); }
    else if (event.altKey && ['1', '2'].includes(event.key)) { event.preventDefault(); setMode(event.key === '1' ? 'files' : 'content'); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.key.startsWith('Arrow') || event.ctrlKey)) {
      event.preventDefault();
      if (!open) { onOpen(); return; }
      if (!results.length) return;
      setSelectedIndex(event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1
        : (selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (event.key === 'Enter' && open) { event.preventDefault(); select(results[selected]); }
  };

  return <div className={`titlebar__search search-dropdown${open ? ' search-dropdown--open' : ''}`} ref={rootRef}>
    <SearchOutlined aria-hidden />
    <input ref={inputRef} role="combobox" aria-label={t('search.title')} aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-autocomplete="list" aria-activedescendant={open && results.length ? `${listId}-${selected}` : undefined}
      placeholder={mode === 'content' ? t('search.contentPlaceholder') : t('topbar.search.placeholder')}
      value={query} onChange={(event) => { setQuery(event.target.value); onOpen(); }} onFocus={onOpen} onKeyDown={keyDown} />
    {query ? <Tooltip title={t('search.clear')}><button className="search-dropdown__clear" type="button" aria-label={t('search.clear')}
      onClick={() => { setQuery(''); inputRef.current?.focus(); }}><CloseOutlined /></button></Tooltip> : <kbd className="search-dropdown__shortcut">Ctrl P</kbd>}
    {open && <div className="search-dropdown__panel" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeWithFocus(); } }}>
      <div className="search-dropdown__toolbar">
        <div className="search-dropdown__modes" role="tablist" aria-label={t('search.mode')}>
          {['files', 'content'].map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value}
            onClick={() => { setMode(value); inputRef.current?.focus(); }}>{t(value === 'files' ? 'search.fileTab' : 'search.contentTab')}</button>)}
        </div>
        <Select
          className="search-dropdown__scope"
          size="small"
          aria-label={t('search.scope')}
          value={search.effectiveScope}
          onChange={(value) => { setScope(value); inputRef.current?.focus(); }}
          popupMatchSelectWidth={false}
          options={[
            { value: 'project', label: t('search.project'), disabled: !search.projectRoot },
            { value: 'folder', label: t('search.folder'), disabled: !search.currentDir },
            { value: 'open', label: t('search.openFiles') },
          ]}
        />
        <Tooltip title={t('search.caseSensitive')}><button type="button" aria-label={t('search.caseSensitive')} aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((value) => !value)}><FontSizeOutlined /></button></Tooltip>
        <Tooltip title={t('search.includeExcluded')}><button type="button" aria-label={t('search.includeExcluded')} aria-pressed={includeExcluded}
          disabled={search.effectiveScope === 'open'} onClick={() => setIncludeExcluded((value) => !value)}><FolderOpenOutlined /></button></Tooltip>
      </div>
      <div className="search-dropdown__context"><span>{query.trim() ? t('search.resultsCount', { count: results.length }) : t('search.suggestions')}</span>
        <Tooltip title={search.root || t('search.openFiles')}><span className="search-dropdown__root">{search.root || t('search.openFiles')}</span></Tooltip>
        {search.loading && <LoadingOutlined aria-label={t('search.searching')} />}
      </div>
      {(search.error || openError) && <div className="search-dropdown__error" role="alert">{t('search.failed', { error: openError || search.error })}</div>}
      <div className="search-dropdown__results" role="listbox" aria-label={t('search.results')} id={listId} ref={listRef} aria-busy={search.loading}>
        {!results.length && <div className="search-dropdown__empty" role="status">{search.loading ? t('search.searching') : query.trim() ? t('search.noResults') : t('search.emptySuggestions')}</div>}
        {results.map((item, index) => <div key={`${item.tabId || item.path}:${item.line_number || 0}`} id={`${listId}-${index}`} role="option"
          aria-selected={selected === index} data-index={index} className="search-dropdown__item" onMouseEnter={() => setSelectedIndex(index)}
          onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}>
          <FileTypeIcon fileName={item.name} extension={item.name.split('.').pop()} />
          <div className="search-dropdown__info"><div className="search-dropdown__name"><span className="search-dropdown__filename"><Highlight text={item.name} query={query} caseSensitive={caseSensitive} /></span>
            {item.modified && <span className="search-dropdown__dirty" aria-label={t('search.unsaved')} />}
            {item.line_number != null && <span className="search-dropdown__line">{item.line_number}:{item.column_number || 1}</span>}
            {item.source === 'open' && <span className="search-dropdown__tag">{t('search.opened')}</span>}</div>
            <div className="search-dropdown__path">{relativeSearchPath(item.path, search.root) || item.name}</div>
            {item.matched_line != null && <div className="search-dropdown__preview"><Highlight text={item.matched_line} query={query} caseSensitive={caseSensitive} /></div>}
          </div><EnterOutlined className="search-dropdown__enter" aria-hidden />
        </div>)}
      </div>
      {search.truncated && <div className="search-dropdown__notice">{t('search.truncated')}</div>}
      {search.skippedFiles > 0 && <div className="search-dropdown__notice">{t('search.skipped', { count: search.skippedFiles })}</div>}
      <div className="search-dropdown__footer"><span><kbd>↑</kbd><kbd>↓</kbd> {t('search.navigate')}</span><span><kbd>Enter</kbd> {opening ? t('search.opening') : t('search.open')}</span><span><kbd>Esc</kbd> {t('search.close')}</span><span><kbd>Alt 1 / 2</kbd> {t('search.mode')}</span></div>
    </div>}
  </div>;
}
