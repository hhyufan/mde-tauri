import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import useFileStore from '@store/useFileStore';
import { useFileManager } from '@hooks/useFileManager';
import { searchFiles } from '@utils/tauriApi';
import { debounce } from '@utils/debounce';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './search-modal.scss';

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
    [],
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

  const getRelativePath = (fullPath) => {
    if (!currentDir || !fullPath) return fullPath;
    const prefix = currentDir.endsWith('\\') || currentDir.endsWith('/')
      ? currentDir : currentDir + '\\';
    if (fullPath.startsWith(prefix)) return fullPath.slice(prefix.length);
    return fullPath;
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      closable={false}
      destroyOnClose
      maskClosable
      styles={{ body: { padding: 0 }, content: { padding: 0 } }}
      style={{ top: 80 }}
      rootClassName="mde-search-modal-root"
    >
      <div className="search-box">
        <div className="search-box__input-wrap">
          <SearchOutlined style={{ fontSize: 16, color: 'var(--text-sec)' }} />
          <Input
            ref={inputRef}
            variant="borderless"
            placeholder={searchContent ? t('search.contentPlaceholder') : t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            allowClear
          />
        </div>

        <div className="search-box__tabs">
          <button
            type="button"
            className={`search-box__tab${!searchContent ? ' search-box__tab--active' : ''}`}
            onClick={() => setSearchContent(false)}
          >
            {t('search.fileTab')}
          </button>
          <button
            type="button"
            className={`search-box__tab${searchContent ? ' search-box__tab--active' : ''}`}
            onClick={() => setSearchContent(true)}
          >
            {t('search.contentTab')}
          </button>
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
                    <FileTypeIcon extension={ext} fileName={item.name} />
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
    </Modal>
  );
}

export default SearchModal;
