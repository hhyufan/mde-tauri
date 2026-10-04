// Keep source lines intact: visual edits must not rewrite comments, blank lines,
// indentation or jump expressions elsewhere in the document.
export const TREE_JUMP = />([a-zA-Z][\w#-]*)(?:\[(\d+)\]|(\+\+)|\+=(\d+))?\s*$/;

export function parseTreeText(text = '') {
  const roots = [];
  const stack = [];
  const indices = new Map();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    const originalText = line.trim();
    if (!originalText) return;
    const indent = line.match(/^[\t ]*/)[0];
    const level = indent.replace(/\t/g, '  ').length;
    const match = originalText.match(TREE_JUMP);
    // A jump inside an inline code span is ordinary code.
    const hasJump = match && (originalText.slice(0, match.index).match(/`/g) || []).length % 2 === 0;
    let jumpLanguage = null;
    let jumpIndex = null;
    if (hasJump) {
      jumpLanguage = match[1].toLowerCase();
      const previous = indices.get(jumpLanguage) || 0;
      jumpIndex = match[2] !== undefined ? Number(match[2])
        : match[3] ? previous + 1
          : match[4] !== undefined ? previous + Number(match[4]) : previous || 1;
      if (match[2] !== undefined || match[3] || match[4] !== undefined) indices.set(jumpLanguage, jumpIndex);
    }
    const node = {
      key: `line-${lineIndex}`, lineIndex, endLine: lines.length, indent, level,
      originalText, title: hasJump ? originalText.slice(0, match.index).trimEnd() : originalText,
      jumpLanguage, jumpIndex, children: [],
    };
    while (stack.length && stack.at(-1).level >= level) stack.pop().endLine = lineIndex;
    if (stack.length) stack.at(-1).children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

export function flattenTree(nodes) {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

export function editTreeSource(source, { type, node, value = '' }) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  if (type === 'rename') {
    const clean = value.replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return source;
    lines[node.lineIndex] = node.indent + clean;
  } else if (type === 'delete') {
    // Delete only node lines in the subtree; retain surrounding blank lines.
    const last = flattenTree([node]).at(-1).lineIndex;
    lines.splice(node.lineIndex, last - node.lineIndex + 1);
  } else if (type === 'add') {
    let index = node ? node.endLine : lines.length;
    while (index > (node ? node.lineIndex + 1 : 0) && !lines[index - 1].trim()) index--;
    lines.splice(index, 0, (node ? node.indent + '  ' : '') + value);
  }
  return lines.join(eol);
}
