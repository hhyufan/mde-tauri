import { useMemo, useState } from 'react';
import useEditorStore from '@store/useEditorStore';
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
  const activeTab = useEditorStore((s) => s.getActiveTab());
  const [collapsed, setCollapsed] = useState({});

  const items = useMemo(() => extractItems(activeTab?.content), [activeTab?.content]);

  if (!activeTab) {
    return <div className="outline__empty">No file open</div>;
  }
  if (items.length === 0) {
    return <div className="outline__empty">No structure found</div>;
  }

  const headings = items.filter((it) => it.type === 'heading');
  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  function toggleCollapse(idx) {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  // Determine which items are hidden due to a collapsed ancestor heading
  function isHiddenByCollapse(idx) {
    const item = items[idx];
    // Walk backward to find the nearest heading that would be an ancestor
    for (let j = idx - 1; j >= 0; j--) {
      const prev = items[j];
      if (prev.type !== 'heading') continue;

      if (item.type === 'heading') {
        // A heading is hidden by any collapsed ancestor heading with lower level
        if (prev.level < item.level && collapsed[j]) return true;
        if (prev.level < item.level) continue;
        break;
      } else {
        // A list item is hidden if its parent heading (any level) is collapsed
        if (collapsed[j]) return true;
        break;
      }
    }
    return false;
  }

  // Check if a heading has any children (next items until same/lower level heading)
  function hasChildren(idx) {
    const item = items[idx];
    if (item.type !== 'heading') return false;
    for (let j = idx + 1; j < items.length; j++) {
      const next = items[j];
      if (next.type === 'heading' && next.level <= item.level) break;
      return true;
    }
    return false;
  }

  return (
    <div className="outline">
      {items.map((item, i) => {
        if (isHiddenByCollapse(i)) return null;

        let paddingLeft;
        if (item.type === 'heading') {
          paddingLeft = 12 + (item.level - minLevel) * 14;
        } else {
          // list items: indent relative to parent heading + their own nesting
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
