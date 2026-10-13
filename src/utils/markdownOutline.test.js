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
