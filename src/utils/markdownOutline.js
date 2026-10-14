// HTML 标题的闭合标签最多向下找这么多行；超出就当作只有开始标签，
// 避免一个未闭合的 `<h1>` 把后面整篇正文都吞进标题里。
const HTML_HEADING_LOOKAHEAD = 10;

export function extractItems(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const items = [];
  let inCodeBlock = false;
  let currentHeadingLevel = 0;

  // 剥离行内标记，只留下渲染后真正可见的文字。
  //
  // 链接必须只保留文字：`[功能文档](docs/x.md)` → `功能文档`。
  // 若把 URL 留在文本里，大纲显示的内容就与实际渲染出的文本对不上，
  // 点击时按文本匹配不到目标，回退到编辑器节点查找（列表项尤其常见）。
  const plain = (value) => value
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // 行内链接 / 图片
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')    // 引用式链接
    .replace(/<[^>]*>/g, '')                     // HTML 标签
    .replace(/[*_`~[\]]/g, '')                   // 残留的 Markdown 标记
    .trim();

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
        text: plain(hm[2]),
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
      const text = plain(raw.replace(closer, '')).replace(/\s+/g, ' ');
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
        text: plain(om[3]),
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
        text: plain(um[2]),
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

