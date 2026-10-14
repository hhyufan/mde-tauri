import { expect, it } from 'vitest';
import { extractItems, outlineRows } from './markdownOutline';

it('extracts headings and lists with the same line numbers while skipping fenced code', () => {
  expect(extractItems('# One\n- item\n```js\n# code\n```\n## Two\n1) ordered')).toEqual([
    { type: 'heading', level: 1, text: 'One', line: 1 },
    { type: 'list-unordered', indent: 0, text: 'item', line: 2, parentLevel: 1 },
    { type: 'heading', level: 2, text: 'Two', line: 6 },
    { type: 'list-ordered', indent: 0, order: 1, text: 'ordered', line: 7, parentLevel: 2 },
  ]);
});

it('hides descendants across long lists without affecting a sibling branch', () => {
  const items = extractItems('# One\n## Child\n' + '- item\n'.repeat(10000) + '# Two\n- visible');
  const rows = outlineRows(items, { 0: true });
  expect(rows[0].hidden).toBe(false);
  expect(rows.slice(1, -2).every((row) => row.hidden)).toBe(true);
  expect(rows.slice(-2).every((row) => !row.hidden)).toBe(true);
  expect(rows[0].canCollapse).toBe(true);
  expect(rows.at(-1).canCollapse).toBe(false);
});

it('preserves nested collapse state when a higher heading is expanded', () => {
  const rows = outlineRows(extractItems('# A\n## B\n- nested\n## C\n- sibling'), { 1: true });
  expect(rows.map((row) => row.hidden)).toEqual([false, false, true, false, false]);
});

it('recognises HTML headings alongside Markdown ones', () => {
  expect(extractItems('<h1>One</h1>\n## Two\n<h3 align="center">Three</h3>')).toEqual([
    { type: 'heading', level: 1, text: 'One', line: 1 },
    { type: 'heading', level: 2, text: 'Two', line: 2 },
    { type: 'heading', level: 3, text: 'Three', line: 3 },
  ]);
});

it('reads HTML heading text through inline tags and line breaks, reporting the start line', () => {
  expect(extractItems('<h2><em>Fancy</em> title</h2>')).toEqual([
    { type: 'heading', level: 2, text: 'Fancy title', line: 1 },
  ]);
  expect(extractItems('<h1>\n  Split title\n</h1>\n- item')).toEqual([
    { type: 'heading', level: 1, text: 'Split title', line: 1 },
    { type: 'list-unordered', indent: 0, text: 'item', line: 4, parentLevel: 1 },
  ]);
});

it('never lets an unclosed HTML heading swallow the content below it', () => {
  expect(extractItems('<h2>Loose heading\n\n- item')).toEqual([
    { type: 'heading', level: 2, text: 'Loose heading', line: 1 },
    { type: 'list-unordered', indent: 0, text: 'item', line: 3, parentLevel: 2 },
  ]);
});

it('ignores HTML headings inside fenced code', () => {
  expect(extractItems('```html\n<h1>Not a heading</h1>\n```\n<h2>Real</h2>')).toEqual([
    { type: 'heading', level: 2, text: 'Real', line: 4 },
  ]);
});
