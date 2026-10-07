import { expect, it } from 'vitest';
import { restoreSelectedHistoryChanges as restore } from './historyChanges';
const select = (start, end = start, endColumn = 10) => ({
  startLineNumber: start,
  startColumn: 1,
  endLineNumber: end,
  endColumn,
});
const change = (os, oe, ms, me) => ({
  originalStartLineNumber: os,
  originalEndLineNumber: oe,
  modifiedStartLineNumber: ms,
  modifiedEndLineNumber: me,
});

it('restores only selected changed lines and leaves unselected edits in the same block intact', () => {
  const old = 'a\nb\nc\nd',
    now = 'a\nB\nC\nD';
  expect(restore(old, now, [change(2, 4, 2, 4)], select(3))).toBe('a\nB\nc\nD');
  expect(restore(old, now, [change(2, 4, 2, 4)], select(2, 3, 1))).toBe('a\nb\nC\nD');
});
it('can restore selected deleted historical lines including at the beginning and end', () => {
  expect(restore('a\nb\nc\nd', 'a\nd', [change(2, 3, 1, 0)], select(3), 'original')).toBe(
    'a\nc\nd',
  );
  expect(restore('a\nb', 'b', [change(1, 1, 0, 0)], select(1), 'original')).toBe('a\nb');
  expect(restore('a\nb', 'a', [change(2, 2, 1, 0)], select(2), 'original')).toBe('a\nb');
});
it('removes only selected added lines and preserves the other additions', () => {
  expect(restore('a\nd', 'a\nb\nc\nd', [change(1, 0, 2, 3)], select(2))).toBe('a\nc\nd');
});
it('handles unequal-size blocks, multiple selected blocks and CRLF without shifting unselected content', () => {
  expect(
    restore(
      'a\nb\nc\nd\ne',
      'A\nB\nx\nd\nE',
      [change(1, 2, 1, 3), change(5, 5, 5, 5)],
      select(1, 5),
    ),
  ).toBe('a\nb\nd\ne');
  expect(restore('a\r\nb\r\n', 'a\r\nB\r\n', [change(2, 2, 2, 2)], select(2))).toBe('a\r\nb\r\n');
  expect(restore('a\nb', 'a\nB', [change(2, 2, 2, 2)], select(1))).toBe('a\nB');
});
