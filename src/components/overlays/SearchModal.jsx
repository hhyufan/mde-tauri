import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useFileStore from '@store/useFileStore';
import { useFileManager } from '@hooks/useFileManager';
import { searchFiles } from '@utils/tauriApi';
import { debounce } from '@utils/debounce';
import './search-modal.scss';

const EXT_COLORS = {
  md: '#4091ff', txt: '#6d6d6f', json: '#ff9500', py: '#34c759',
  js: '#f7df1e', html: '#e44d26', css: '#264de4', rs: '#ff3b30',
  ts: '#3178c6', jsx: '#f7df1e', tsx: '#3178c6', scss: '#c76494',
};

function SearchModal({ open, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [searchContent, setSearchContent] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const currentDir = useFileStore((s) => s.currentDir);
  const { openFileFromPath } = useFileManager();

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const doSearch = useCallback(
    debounce(async (q, dir, isContent) => {
      if (!q.trim() || !dir) {
        setResults([]);
        setLoading(false);
        return;
      }
      try {
        const res = await searchFiles(dir, q.trim(), isContent, 80);
        setResults(res);
        setSelectedIndex(0);
      } catch (_) {
        setResults([]);
      }
      setLoading(false);
    }, 250),
    []
  );

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    doSearch(query, currentDir, searchContent);
  }, [query, searchContent, currentDir, doSearch]);

  const handleSelect = useCallback(async (item) => {
    await openFileFromPath(item.path, item.name);
    onClose();
    if (item.line_number != null) {
      // Wait one frame for React to render the new tab content into Monaco
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('editor:jump-to-line', {
          detail: { line: item.line_number, text: item.matched_line ?? '' },
        }));
      }, 150);
    }
  }, [openFileFromPath, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && results.length > 0) {
      handleSelect(results[selectedIndex]);
    }
  }, [results, selectedIndex, handleSelect, onClose]);

  useEffect(() => {
    const el = resultsRef.current?.children[selectedIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  const getRelativePath = (fullPath) => {
    if (!currentDir || !fullPath) return fullPath;
    const prefix = currentDir.endsWith('\\') || currentDir.endsWith('/')
      ? currentDir : currentDir + '\\';
    if (fullPath.startsWith(prefix)) return fullPath.slice(prefix.length);
    return fullPath;
  };

  return (
    <div className="search-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-box">
        <div className="search-box__input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder={searchContent ? t('search.contentPlaceholder') : t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className={`search-box__mode-btn ${searchContent ? 'search-box__mode-btn--active' : ''}`}
            onClick={() => setSearchContent((v) => !v)}
            title={t('search.toggleContent')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </button>
        </div>

        <div className="search-box__tabs">
          <span
            className={`search-box__tab ${!searchContent ? 'search-box__tab--active' : ''}`}
            onClick={() => setSearchContent(false)}
          >
            {t('search.fileTab')}
          </span>
          <span
            className={`search-box__tab ${searchContent ? 'search-box__tab--active' : ''}`}
            onClick={() => setSearchContent(true)}
          >
            {t('search.contentTab')}
          </span>
        </div>

        <div className="search-box__results" ref={resultsRef}>
          {!currentDir ? (
            <div className="search-box__empty">{t('search.noDir')}</div>
          ) : loading ? (
            <div className="search-box__empty">{t('search.searching')}</div>
          ) : query && results.length === 0 ? (
            <div className="search-box__empty">{t('search.noResults')}</div>
          ) : (
            results.map((item, idx) => {
              const ext = item.name.split('.').pop() || '';
              const relPath = getRelativePath(item.path);
              const dir = relPath.includes('\\')
                ? relPath.substring(0, relPath.lastIndexOf('\\'))
                : relPath.includes('/')
                  ? relPath.substring(0, relPath.lastIndexOf('/'))
                  : '';
              return (
                <div
                  key={`${item.path}-${item.line_number || 0}-${idx}`}
                  className={`search-box__item ${idx === selectedIndex ? 'search-box__item--selected' : ''}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className="search-box__item-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke={EXT_COLORS[ext] || '#6d6d6f'} strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </span>
                  <div className="search-box__item-info">
                    <span className="search-box__item-name">
                      {item.name}
                      {item.line_number != null && (
                        <span className="search-box__item-line">:{item.line_number}</span>
                      )}
                    </span>
                    {item.matched_line && (
                      <span className="search-box__item-preview">{item.matched_line}</span>
                    )}
                  </div>
                  {dir && <span className="search-box__item-path">{dir}</span>}
                </div>
              );
            })
          )}
        </div>
        <div className="search-box__hint">
          {searchContent ? t('search.contentHint') : t('search.hint')}
        </div>
      </div>
    </div>
  );
}

export default SearchModal;
