import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import './outline.scss';

/**
 * 从 Markdown 文本中提取标题与列表项，供侧边栏大纲展示。
 */
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

    // 标题行。
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

    // 有序列表：支持 `1.` 与 `1)` 两种前缀。
    const om = line.match(/^(\s*)(\d+)[.)]\s+(.+)/);
    if (om) {
      items.push({
        type: 'list-ordered',
        indent: Math.floor(om[1].length / 2),
        order: Number(om[2]),
        text: om[3].replace(/[*_`~[\]]/g, '').trim(),
        line: i + 1,
        parentLevel: currentHeadingLevel,
      });
      continue;
    }

    // 无序列表：支持 `-`、`*`、`+` 三种前缀。
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

  // 根据祖先标题的折叠态判断条目是否应隐藏。
  //
  // 语义上，每个标题或列表项都隶属于“最近且层级更低”的前置标题；该标题再
  // 继续向上寻找最近且层级更低的标题，于是形成完整祖先链。
  //
  // 实现上通过倒序遍历并维护 `minLevel`：
  // 1. 只有 `level < minLevel` 的前置标题才可能成为祖先；
  // 2. 一旦命中，就把 `minLevel` 收窄到该标题层级；
  // 3. 后续只能继续匹配更高层祖先。
  //
  // 这样可以正确处理不同一级标题之间的边界，避免前一个分支的折叠状态误伤
  // 后一个并列分支中的列表项。
  const isHiddenByCollapse = useCallback((idx) => {
    const item = items[idx];
    let minLevel;
    if (item.type === 'heading') {
      minLevel = item.level;
    } else {
      // 列表项归属于最近标题。把 `minLevel` 设为 `parentLevel + 1`，可以让
      // 该标题在第一次命中时立即成为祖先节点。
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

  // 监听工具栏发出的全局折叠/展开事件。
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
