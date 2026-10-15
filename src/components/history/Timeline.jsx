import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import ChevronIcon from '@components/ui/ChevronIcon';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
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

  // 默认收起：本地历史是资源管理器左下角的一个可展开面板，
  // 不展开时只占标题那一行，把纵向空间让给文件树。
  const [expanded, setExpanded] = useState(false);
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
    <section className={`timeline${expanded ? ' timeline--open' : ''}`}>
      <header className="timeline__header">
        <button
          type="button"
          className="timeline__toggle"
          aria-expanded={expanded}
          aria-label={t('history.title')}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronIcon className="timeline__chevron" />
        </button>
        <span className="timeline__label">{t('history.title')}</span>
        <span className="timeline__count">{entries.length}</span>
        <Tooltip title={t('history.refresh')} placement="top" mouseEnterDelay={0.3}>
          <button type="button" className="timeline__refresh" aria-label={t('history.refresh')} onClick={load}>
            <ReloadOutlined />
          </button>
        </Tooltip>
      </header>

      {/*
        内容始终挂载，靠高度过渡做出抽屉效果——条件渲染会把元素直接移除，
        没有任何可过渡的高度。
        折叠时用 aria-hidden 让辅助技术跳过它（jsdom 下的 role 查询同样会忽略）。
      */}
      <div className="timeline__body" aria-hidden={!expanded}>
        {loading ? (
          <div className="timeline__placeholder">{t('history.empty')}</div>
        ) : entries.length === 0 ? (
          /*
           * 没有任何历史版本时，用与文件树 / 大纲同一套空状态文案。
           * 这里刻意不出人物：抽屉上限是 6 行（162px），而 4:3 的立绘要放进这个高度
           * 只能缩到 168px 宽（8.6 倍缩放，实测明显发糊），整块还会超出 44px 被裁。
           * 立绘留给空间充足的对比视图（见 history.scss 的 .history-diff__empty）。
           */
          <MokiStatusEmpty
            compact
            art={null}
            title={t('empty.history.title')}
            hint={t('empty.history.hint')}
          />
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
        )}
      </div>
    </section>
  );
}
