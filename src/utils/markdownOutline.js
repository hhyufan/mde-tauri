export function extractItems(content) {
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

// Each heading is pushed/popped once. Long lists no longer scan backwards
// through every preceding list item to find their collapsed ancestors.
export function outlineRows(items, collapsed) {
  const ancestors = [];
  return items.map((item, index) => {
    if (item.type === 'heading') {
      while (ancestors.length && ancestors.at(-1).level >= item.level) ancestors.pop();
    }
    const hidden = ancestors.some((heading) => collapsed[heading.index]);
    const next = items[index + 1];
    const canCollapse = item.type === 'heading' && Boolean(next)
      && (next.type !== 'heading' || next.level > item.level);
    if (item.type === 'heading') ancestors.push({ level: item.level, index });
    return { item, index, hidden, canCollapse };
  });
}

