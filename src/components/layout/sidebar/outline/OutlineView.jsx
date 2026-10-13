import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import { useMarkdownAnalysis } from '@hooks/useMarkdownAnalysis';
import { extractItems, outlineRows } from '@utils/markdownOutline';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import './outline.scss';

function jump(item) {
  window.dispatchEvent(new CustomEvent('outline:jump', {
    detail: { line: item.line, text: item.text, type: item.type },
  }));
}

function HeadingBadge({ level }) {
  return <span className="outline__badge outline__badge--heading">H{level}</span>;
}

function ListBadge({ type, order }) {
  return (
    <span className={`outline__badge outline__badge--list`}>
      {type === 'list-ordered' ? `${order || 1}.` : '•'}
    </span>
  );
}

/**
 * Markdown 大纲视图。
 *
 * 解析当前缓冲区中的标题与列表层级，支持折叠、展开以及与编辑区/预览区的
 * 双向跳转联动。
 */
function OutlineView() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const fallback = useMemo(() => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    return tab?.content || '';
  }, [activeTabId]);
  const content = useEditorBufferContent(activeTabId, fallback, 320);
  const [collapsed, setCollapsed] = useState({});
  const { value: items } = useMarkdownAnalysis(activeTabId, content, 'outline');

  const headings = useMemo(() => items.filter((it) => it.type === 'heading'), [items]);
  const minLevel = useMemo(
    () => (headings.length > 0 ? headings.reduce((level, heading) => Math.min(level, heading.level), 6) : 1),
    [headings],
  );

  const rows = useMemo(() => outlineRows(items, collapsed), [items, collapsed]);

  // 监听工具栏发出的全局折叠/展开事件。
  useEffect(() => {
    const handleCollapseAll = () => {
      const next = {};
      rows.forEach(({ index, canCollapse }) => { if (canCollapse) next[index] = true; });
      setCollapsed(next);
    };
    const handleExpandAll = () => setCollapsed({});

    window.addEventListener('outline:collapseAll', handleCollapseAll);
    window.addEventListener('outline:expandAll', handleExpandAll);
    return () => {
      window.removeEventListener('outline:collapseAll', handleCollapseAll);
      window.removeEventListener('outline:expandAll', handleExpandAll);
    };
  }, [rows]);

  function toggleCollapse(idx) {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  if (!activeTabId) {
    return <MokiStatusEmpty title={t('empty.outlineNoFile.title')} hint={t('empty.outlineNoFile.hint')} />;
  }
  if (items.length === 0) {
    return <MokiStatusEmpty title={t('empty.outline.title')} hint={t('empty.outline.hint')} />;
  }

  return (
    <div className="outline">
      {rows.map(({ item, index: i, hidden, canCollapse }) => {
        if (hidden) return null;

        let paddingLeft;
        if (item.type === 'heading') {
          paddingLeft = 12 + (item.level - minLevel) * 14;
        } else {
          paddingLeft = 12 + (item.parentLevel - minLevel + 1) * 14 + item.indent * 10;
        }


        const isCollapsed = collapsed[i];

        return (
          <div
            key={i}
            className={`outline__item outline__item--${item.type}`}
            style={{ paddingLeft }}
            onClick={() => jump(item)}
          >
            {canCollapse ? (
              <span
                className={`outline__toggle ${isCollapsed ? 'outline__toggle--collapsed' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleCollapse(i); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            ) : (
              <span className="outline__toggle-spacer" />
            )}

            {item.type === 'heading'
              ? <HeadingBadge level={item.level} />
              : <ListBadge type={item.type} order={item.order} />}

            <span className="outline__text">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export default OutlineView;
export { extractItems };
