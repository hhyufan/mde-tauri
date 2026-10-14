import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkMarkdownHtml from './remarkMarkdownHtml';

const parse = (text) => {
  const processor = unified().use(remarkParse).use(remarkMath).use(remarkMarkdownHtml);
  return processor.runSync(processor.parse(text), text);
};

describe('HTML and Markdown boundaries', () => {
  it('separates complete HTML fragments, comments and void tags from following Markdown', () => {
    for (const html of ['<br><br />', '<div title="a > b">标签</div>', '<!-- 注释 -->', '<img src="x">', '<span>标签</span>']) {
      const tree = parse(`${html}\n# 标题\n\n<br>\n$$\nx^2\n$$`);
      expect(tree.children.slice(1).map((node) => node.type)).toEqual(['heading', 'paragraph', 'math']);
      if (tree.children[0].type === 'html') expect(tree.children[0].value).toBe(html);
    }
  });
  it('preserves Markdown-like text in raw HTML and code, including raw-text tags', () => {
    for (const html of ['<div>\n# 内部\n</div>', '<pre>\n<br>\n# 内部\n</pre>', '<script>"<div>";</script>']) {
      const tree = parse(`${html}\n# 外部`);
      expect(tree.children.map((node) => node.type)).toEqual(['html', 'heading']);
      expect(tree.children[0].value).toBe(html);
    }
    expect(parse('<div>\n# 未闭合').children[0].type).toBe('html');
    expect(parse('```html\n<br>\n# 源码\n```').children[0].type).toBe('code');
  });
  it('handles block quotes and inline line breaks without consuming content', () => {
    const tree = parse('> <br>\n> # 标题\n\n前<br>后');
    expect(tree.children[0].children.map((node) => node.type)).toEqual(['paragraph', 'heading']);
    expect(tree.children[1].children.map((node) => node.type)).toEqual(['text', 'break', 'text']);
  });
  it('retains source offsets for emphasis markers after reparsing, including quotes and CRLF', () => {
    for (const text of ['<br>\n**加粗** _斜体_', '> <br>\r\n> **加粗** _斜体_']) {
      const tree = parse(text);
      const parent = tree.children.at(-1).type === 'blockquote' ? tree.children[0].children.at(-1) : tree.children.at(-1);
      for (const node of parent.children.filter((node) => ['strong', 'emphasis'].includes(node.type))) {
        expect(text[node.position.start.offset]).toBe(node.type === 'strong' ? '*' : '_');
      }
    }
  });
});

describe('editing paragraphs and block boundaries', () => {
  const edit = (text) => {
    const processor = unified().use(remarkParse).use(remarkMath).use(remarkMarkdownHtml, { editing: true });
    return processor.runSync(processor.parse(text), text);
  };
  it('does not turn required separators into empty paragraphs, but preserves additional blank lines', () => {
    expect(edit('A\n\nB\n').children.map((node) => node.type)).toEqual(['paragraph', 'paragraph']);
    const extra = edit('A\n\n\nB\n');
    expect(extra.children).toHaveLength(3);
    expect(extra.children[1].children).toEqual([]);
    const html = '<p align="center">\n<img src="image.png" />\n</p>';
    expect(edit(`${html}\n\n## 功能\n`).children.map((node) => node.type)).toEqual(['mokiHtmlBlock', 'heading']);
    expect(edit(`${html}\n\n\n## 功能\n`).children.map((node) => node.type)).toEqual(['mokiHtmlBlock', 'paragraph', 'heading']);
  });
  it('keeps HTML and fenced code contents intact, including their internal blank lines', () => {
    const source = '<pre>\n\n# raw\n</pre>\n\n```text\n\n# code\n\n```\n';
    const nodes = edit(source).children;
    expect(nodes.map((node) => node.type)).toEqual(['mokiHtmlBlock', 'code']);
    expect(nodes[0].value).toBe('<pre>\n\n# raw\n</pre>');
    expect(nodes[1].value).toBe('\n# code\n');
  });
  it('preserves leading, trailing and quoted empty paragraphs, including CRLF source', () => {
    const root = edit('\r\nA\r\n\r\n\r\n');
    expect(root.children).toHaveLength(4);
    expect(root.children[0].children).toEqual([]);
    expect(root.children[2].children).toEqual([]);
    const quote = edit('> A\n>\n>\n> B').children[0];
    expect(quote.children).toHaveLength(3);
    expect(quote.children[1].children).toEqual([]);
  });
});
