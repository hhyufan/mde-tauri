import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import './outline.scss';

function extractItems(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const items = [];
  let inCodeBlock = false;
  let currentHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      currentHeadingLevel = hm[1].length;
      items.push({
        type: 'heading',
        level: currentHeadingLevel,
        text: hm[2].replace(/[*_`~[\]]/g, '').trim(),
        line: i + 1,
      });
      continue;
    }

    // Ordered list:  "1. " or "1) "
    const om = line.match(/^(\s*)\d+[.)]\s+(.+)/);
    if (om) {
      items.push({
        type: 'list-ordered',
        indent: Math.floor(om[1].length / 2),
        text: om[2].replace(/[*_`~[\]]/g, '').trim(),
        line: i + 1,
        parentLevel: currentHeadingLevel,
      });
      continue;
    }

    // Unordered list: "- ", "* ", "+ "
    const um = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (um) {
      items.push({
        type: 'list-unordered',
        indent: Math.floor(um[1].length / 2),
        text: um[2].replace(/[*_`~[\]]/g, '').trim(),
        line: i + 1,
        parentLevel: currentHeadingLevel,
      });
    }
  }
  return items;
}

function jump(item) {
  window.dispatchEvent(new CustomEvent('outline:jump', {
    detail: { line: item.line, text: item.text, type: item.type },
  }));
}

function HeadingBadge({ level }) {
  return <span className="outline__badge outline__badge--heading">H{level}</span>;
}

function ListBadge({ type }) {
  return (
    <span className={`outline__badge outline__badge--list`}>
      {type === 'list-ordered' ? '1.' : '•'}
    </span>
  );
}

function OutlineView() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const fallback = useMemo(() => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    return tab?.content || '';
  }, [activeTabId]);
  const content = useEditorBufferContent(activeTabId, fallback, 320);
  const [collapsed, setCollapsed] = useState({});

  const items = useMemo(() => extractItems(content), [content]);

  const headings = useMemo(() => items.filter((it) => it.type === 'heading'), [items]);
  const minLevel = useMemo(
    () => (headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1),
    [headings],
  );

  const hasChildren = useCallback((idx) => {
    const item = items[idx];
    if (!item || item.type !== 'heading') return false;
    for (let j = idx + 1; j < items.length; j++) {
      const next = items[j];
      if (next.type === 'heading' && next.level <= item.level) break;
      return true;
    }
    return false;
  }, [items]);

  // Determine which items are hidden due to a collapsed ancestor heading.
  //
  // Correct tree semantics: every heading/list item belongs to the nearest
  // preceding heading of STRICTLY LOWER level, and that heading in turn
  // belongs to the nearest preceding heading of strictly lower level than
  // itself, and so on — this forms the ancestor chain.
  //
  // Algorithm: walk backward tracking `minLevel`. A previous heading is an
  // ancestor iff its level < minLevel. When found, it narrows `minLevel`
  // to its own level, so only strictly higher-ranked headings can match
  // next. This correctly handles cases like:
  //
  //   # H1-A
  //   ## H2-A           (collapsed)
  //   ### H3-A
  //   # H1-B
  //   - list item       <- NOT hidden: its ancestor chain is only H1-B
  //                        (H2-A is not an ancestor; it was closed by H1-B)
  const isHiddenByCollapse = useCallback((idx) => {
    const item = items[idx];
    let minLevel;
    if (item.type === 'heading') {
      minLevel = item.level;
    } else {
      // List item belongs to the most recent heading (at item.parentLevel).
      // Setting minLevel = parentLevel + 1 makes that parent heading match
      // on the first hit so it becomes the first ancestor.
      minLevel = (item.parentLevel || 0) + 1;
    }

    for (let j = idx - 1; j >= 0; j--) {
      const prev = items[j];
      if (prev.type !== 'heading') continue;
      if (prev.level < minLevel) {
        if (collapsed[j]) return true;
        minLevel = prev.level;
        if (minLevel <= 1) break;
      }
    }
    return false;
  }, [items, collapsed]);

  // Wire up collapse-all / expand-all toolbar events
  useEffect(() => {
    const handleCollapseAll = () => {
      const next = {};
      items.forEach((_, i) => { if (hasChildren(i)) next[i] = true; });
      setCollapsed(next);
    };
    const handleExpandAll = () => setCollapsed({});

    window.addEventListener('outline:collapseAll', handleCollapseAll);
    window.addEventListener('outline:expandAll', handleExpandAll);
    return () => {
      window.removeEventListener('outline:collapseAll', handleCollapseAll);
      window.removeEventListener('outline:expandAll', handleExpandAll);
    };
  }, [items, hasChildren]);

  function toggleCollapse(idx) {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  if (!activeTabId) {
    return <div className="outline__empty">{t('sidebar.outline.noFile')}</div>;
  }
  if (items.length === 0) {
    return <div className="outline__empty">{t('sidebar.outline.empty')}</div>;
  }

  return (
    <div className="outline">
      {items.map((item, i) => {
        if (isHiddenByCollapse(i)) return null;

        let paddingLeft;
        if (item.type === 'heading') {
          paddingLeft = 12 + (item.level - minLevel) * 14;
        } else {
          paddingLeft = 12 + (item.parentLevel - minLevel + 1) * 14 + item.indent * 10;
        }

        const canCollapse = hasChildren(i);
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
              : <ListBadge type={item.type} />}

            <span className="outline__text">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export default OutlineView;
export { extractItems };
