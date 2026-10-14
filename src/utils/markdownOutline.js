// HTML 标题的闭合标签最多向下找这么多行；超出就当作只有开始标签，
// 避免一个未闭合的 `<h1>` 把后面整篇正文都吞进标题里。
const HTML_HEADING_LOOKAHEAD = 10;

export function extractItems(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const items = [];
  let inCodeBlock = false;
  let currentHeadingLevel = 0;

  // 剥离行内标签与 Markdown 标记，只留下可见文字。
  const plain = (value) => value.replace(/<[^>]*>/g, '').replace(/[*_`~[\]]/g, '').replace(/\s+/g, ' ').trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Markdown 标题。
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

    // HTML 标题：`<h1>标题</h1>`。允许属性，允许内容里再嵌行内标签；
    // 开始标签单独占一行时，向下找到闭合标签（有上限，避免把正文整段吞掉）。
    const hh = line.match(/^\s*<h([1-6])(?:\s[^>]*)?>([\s\S]*)$/i);
    if (hh) {
      const level = Number(hh[1]);
      const startLine = i;
      const closer = new RegExp(`</h${level}>`, 'i');
      let raw = hh[2];
      let endLine = i;
      if (!closer.test(raw)) {
        // 只有找到闭合标签才向下扩展；否则只认本行，免得把后文吞成标题。
        let collected = raw;
        for (let j = i + 1; j < lines.length && j - i <= HTML_HEADING_LOOKAHEAD; j++) {
          collected += `\n${lines[j]}`;
          if (closer.test(lines[j])) { raw = collected; endLine = j; break; }
        }
      }
      const text = plain(raw.replace(closer, ''));
      i = endLine;
      if (text) {
        currentHeadingLevel = level;
        items.push({ type: 'heading', level, text, line: startLine + 1 });
      }
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

