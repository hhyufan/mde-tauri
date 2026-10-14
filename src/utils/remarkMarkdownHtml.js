// A complete HTML fragment on its own line should not absorb the Markdown
// below it. Keep open containers (and their contents) as intentional raw HTML.
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<\/?([A-Za-z][\w:-]*)(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g;

export function htmlFragmentBoundary(value) {
  const stack = [];
  token.lastIndex = 0;
  let consumed = 0;
  let match;
  while ((match = token.exec(value))) {
    if (!stack.length && value.slice(consumed, match.index).trim()) return 0;
    const name = match[1]?.toLowerCase();
    if (name) {
      if (match[0].startsWith('</')) {
        if (stack.pop() !== name) return 0;
      } else if (!voidTags.has(name) && !match[0].endsWith('/>')) stack.push(name);
      // Never interpret code inside raw-text HTML as nested markup.
      if (['script', 'style', 'pre', 'textarea'].includes(name) && stack.at(-1) === name) {
        const closing = new RegExp(`</${name}\\s*>`, 'ig');
        closing.lastIndex = token.lastIndex;
        const end = closing.exec(value);
        if (!end) return 0;
        stack.pop(); token.lastIndex = closing.lastIndex;
      }
    }
    if (!stack.length) {
      consumed = token.lastIndex;
      const rest = value.slice(token.lastIndex);
      const newline = /^[\t ]*(?:\r\n|\n|\r)/.exec(rest);
      if (newline) return token.lastIndex + newline[0].length;
      if (!rest.trim()) return value.length;
    }
  }
  return 0;
}

export default function remarkMarkdownHtml({ editing = false } = {}) {
  const processor = this;
  let source = '';
  let sourceLines = [];
  let lineStarts = [];
  // Reparsing a suffix creates local offsets. Rebase them before Milkdown's
  // emphasis-marker plugin reads the original source at those positions.
  const rebase = (tree, node, boundary) => {
    if (!node.position) return;
    const valueLines = node.value.split(/\r\n|\r|\n/);
    const prefix = node.value.slice(0, boundary);
    const prefixLines = prefix.split(/\r\n|\r|\n/);
    const mapPoint = (point) => {
      const line = prefixLines.length + point.line - 1;
      const column = point.column + (point.line === 1 ? prefixLines.at(-1).length : 0);
      const globalLine = node.position.start.line + line - 1;
      const sourceLine = sourceLines[globalLine - 1] || '';
      const indent = sourceLine.indexOf(valueLines[line - 1] || '');
      const globalColumn = column + Math.max(0, indent);
      // Use original line endings when calculating offsets (including CRLF).
      const lineOffset = lineStarts[globalLine - 1] || 0;
      return { line: globalLine, column: globalColumn, offset: source ? lineOffset + globalColumn - 1 : node.position.start.offset + boundary + point.offset };
    };
    const walk = (current) => {
      if (current.position) current.position = { start: mapPoint(current.position.start), end: mapPoint(current.position.end) };
      current.children?.forEach(walk);
    };
    walk(tree);
  };
  const visit = (parent) => {
    if (!parent.children) return;
    const block = ['root', 'blockquote', 'listItem'].includes(parent.type);
    parent.children = parent.children.flatMap((node) => {
      if (node.type !== 'html') { visit(node); return [node]; }
      if (/^\s*<br\s*\/?\s*>\s*$/i.test(node.value)) {
        return [block ? { type: 'paragraph', children: [], position: node.position } : { type: 'break', position: node.position }];
      }
      if (!block) return [node];
      const boundary = htmlFragmentBoundary(node.value);
      if (!boundary || boundary === node.value.length) return [node];
      const html = { ...node, value: node.value.slice(0, boundary).trimEnd() };
      const lines = html.value.split(/\r\n|\r|\n/);
      html.position = { start: { line: 1, column: 1, offset: 0 }, end: { line: lines.length, column: lines.at(-1).length + 1, offset: html.value.length } };
      rebase({ children: [html] }, node, 0);
      const following = processor.parse(node.value.slice(boundary));
      rebase(following, node, boundary);
      const fragment = { type: parent.type, children: [html, ...following.children] };
      visit(fragment);
      return fragment.children;
    });
  };
  return (tree, file) => {
    source = String(file.value || '');
    sourceLines = source.split(/\r\n|\r|\n/);
    lineStarts = [0, ...[...source.matchAll(/\r\n|\r|\n/g)].map((match) => match.index + match[0].length)];
    visit(tree);
    if (editing) {
      const empty = () => ({ type: 'paragraph', children: [] });
      const normalize = (parent) => {
        if (!parent.children) return;
        const container = ['root', 'blockquote', 'listItem'].includes(parent.type);
        const children = [];
        let previous;
        for (const child of parent.children) {
          if (container && previous?.position && child.position) {
            // One source blank line separates blocks; additional ones are
            // editable empty paragraphs. Never materialize the separator.
            const count = child.position.start.line - previous.position.end.line - 2;
            for (let i = 0; i < count; i++) children.push(empty());
          }
          normalize(child);
          if (container && child.type === 'html') child.type = 'mokiHtmlBlock';
          else if (container && child.type === 'paragraph' && child.children?.length
            && child.children.every((item) => item.type === 'html')) {
            child.value = child.children.map((item) => item.value).join(''); child.type = 'mokiHtmlBlock'; delete child.children;
          }
          children.push(child); previous = child;
        }
        parent.children = children;
      };
      normalize(tree);
      if (!tree.children.length && !source.trim()) {
        const count = (source.match(/\r\n|\r|\n/g)?.length || 0) + 1;
        for (let i = 0; i < count; i++) tree.children.push(empty());
      }
      const first = tree.children[0];
      const last = tree.children.at(-1);
      if (first?.position) {
        for (let i = 1; i < first.position.start.line; i++) tree.children.unshift(empty());
      }
      if (last?.position) {
        const tail = source.slice(last.position.end.offset);
        const endings = tail.match(/\r\n|\r|\n/g)?.length || 0;
        for (let i = 1; i < endings; i++) tree.children.push(empty());
      }
    }
  };
}
