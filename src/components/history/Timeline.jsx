import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { DownOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import { historyList, historyRead, onHistoryChanged } from '@utils/tauriApi';
import './history.scss';

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
  return `${day} ${time}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 左侧资源管理器底部的本地历史时间线（VS Code Timeline 同款位置）。
 *
 * 随当前活动文件联动；点击某个版本把 diff 写入 useHistoryStore，
 * 由主编辑区渲染对比视图。仅对落在真实磁盘的文件展示。
 */
export default function Timeline() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const diff = useHistoryStore((s) => s.diff);
  const setDiff = useHistoryStore((s) => s.setDiff);

  const [expanded, setExpanded] = useState(true);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const tab = tabs.find((item) => item.id === activeTabId) || null;
  const eligible = tab
    && typeof tab.path === 'string'
    && tab.path
    && !tab.path.startsWith('cloud://')
    && !tab.path.startsWith('content://');

  const load = useCallback(async () => {
    if (!eligible || !tab.path) { setEntries([]); return; }
    setLoading(true);
    try {
      setEntries((await historyList(tab.path)) || []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [eligible, tab?.path]);

  useEffect(() => {
    setDiff(null);
    load();
  }, [activeTabId, load, setDiff]);

  // 保存后原生侧会发出 history-changed；匹配当前文件时刷新时间线，
  // 让新快照即时出现，而不是等到切换标签或手动刷新。
  useEffect(() => {
    if (!eligible || !tab?.path) return undefined;
    const unlisten = onHistoryChanged(({ path }) => {
      if (path === tab.path) load();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [eligible, tab?.path, load]);

  const openDiff = async (timestamp) => {
    if (!tab?.path) return;
    try {
      const content = await historyRead(tab.path, timestamp);
      setDiff({ tabId: activeTabId, timestamp, content });
    } catch {
      /* 版本可能已被清理，忽略。 */
    }
  };

  if (!eligible) return null;

  return (
    <section className="timeline">
      <header className="timeline__header">
        <button
          type="button"
          className="timeline__toggle"
          aria-expanded={expanded}
          aria-label={t('history.title')}
          onClick={() => setExpanded(!expanded)}
        >
          <DownOutlined className={expanded ? 'is-open' : ''} />
        </button>
        <span className="timeline__label">{t('history.title')}</span>
        <span className="timeline__count">{entries.length}</span>
        <Tooltip title={t('history.refresh')} placement="top" mouseEnterDelay={0.3}>
          <button type="button" className="timeline__refresh" aria-label={t('history.refresh')} onClick={load}>
            <ReloadOutlined />
          </button>
        </Tooltip>
      </header>

      {expanded && (
        loading ? (
          <div className="timeline__placeholder">{t('history.empty')}</div>
        ) : entries.length === 0 ? (
          <div className="timeline__placeholder">{t('history.empty')}</div>
        ) : (
          <ul className="timeline__list">
            {entries.map((entry) => (
              <li key={entry.timestamp}>
                <button
                  type="button"
                  className={'timeline__item' + (diff && diff.timestamp === entry.timestamp ? ' is-selected' : '')}
                  onClick={() => openDiff(entry.timestamp)}
                >
                  {entry.restoredFrom != null && (
                    <Tooltip
                      title={t('history.rollbackFrom', { time: new Date(entry.restoredFrom).toLocaleString() })}
                      placement="top" mouseEnterDelay={0.3}
                    >
                      <span className="timeline__rollback" role="img" aria-label={t('history.rollback')}>
                        <HistoryOutlined aria-hidden="true" />
                      </span>
                    </Tooltip>
                  )}
                  <span className="timeline__time">{formatTime(entry.timestamp)}</span>
                  <span className="timeline__size">{formatBytes(entry.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
