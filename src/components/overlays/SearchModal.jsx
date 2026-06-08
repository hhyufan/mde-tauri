/**
 * 搜索弹窗模块。
 *
 * 提供工作区级文件名与内容检索界面，集中处理搜索输入、结果列表展示、
 * 键盘导航以及与编辑器打开跳转相关的交互编排。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import useFileStore from '@store/useFileStore';
import { useFileManager } from '@hooks/useFileManager';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import { searchFiles } from '@utils/tauriApi';
import { debounce } from '@utils/debounce';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './search-modal.scss';

/**
 * 全局搜索弹窗。
 *
 * 支持按文件名或文件内容搜索当前工作目录，并提供键盘上下选择、回车打开、
 * 以及内容匹配后跳转到目标行的联动能力。
 *
 * @param {object} props 组件属性。
 * @param {boolean} props.open 控制弹窗显示状态。
 * @param {() => void} props.onClose 关闭弹窗的回调。
 */
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
  const { isMobileLayout } = useResponsiveLayout();
  const fullScreen = isMobileLayout;

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  /**
   * 以防抖方式执行搜索请求，并在请求完成后刷新结果列表与加载态。
   *
   * @param {string} q 当前搜索关键词。
   * @param {string} dir 当前工作目录。
   * @param {boolean} isContent 是否执行内容搜索。
   * @returns {Promise<void>} 搜索完成后更新组件状态。
   */
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

  /**
   * 打开选中的搜索项；如果命中了内容搜索结果，则在文件打开后跳转到对应行。
   *
   * @param {object} item 当前选中的搜索结果项。
   * @returns {Promise<void>} 打开并在需要时定位到目标行。
   */
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

  /**
   * 处理搜索框键盘导航，包括关闭、上下切换与回车确认。
   *
   * @param {KeyboardEvent} e 键盘事件对象。
   */
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

  /**
   * 将绝对路径裁剪为相对当前工作目录的展示路径，便于结果列表压缩信息密度。
   *
   * @param {string} fullPath 待转换的绝对路径。
   * @returns {string} 相对当前工作目录的展示路径。
   */
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
      width={fullScreen ? '100vw' : 560}
      closable={false}
      destroyOnHidden
      maskClosable
      styles={{ body: { padding: 0 }, content: { padding: 0 } }}
      style={fullScreen ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : { top: 80 }}
      rootClassName={`mde-search-modal-root${fullScreen ? ' mde-search-modal-root--fullscreen' : ''}`}
    >
      <div className={`search-box${fullScreen ? ' search-box--fullscreen' : ''}`}>
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
          {isMobileLayout && (
            <button
              type="button"
              className="search-box__close-btn"
              onClick={onClose}
              aria-label={t('topbar.close')}
              title={t('topbar.close')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
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
