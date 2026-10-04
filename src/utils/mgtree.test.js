import { describe, expect, it } from 'vitest';
import { editTreeSource, flattenTree, parseTreeText } from './mgtree';
import { getFileLanguage } from './fileLanguage';
import { tokenizeTreeLine } from './mgtreeLanguage';

describe('mgtree compatibility', () => {
  it('builds nested nodes from spaces or tabs and retains source positions', () => {
    const nodes = parseTreeText('Root\r\n\r\n  Child\r\n\t  Grandchild\r\nNext');
    expect(nodes).toHaveLength(2);
    expect(nodes[0].children[0]).toMatchObject({ title: 'Child', lineIndex: 2 });
    expect(nodes[0].children[0].children[0].title).toBe('Grandchild');
    expect(nodes[0].endLine).toBe(4);
  });

  it('resolves all four jump forms independently per language without rewriting syntax', () => {
    const source = 'A >java[2]\nB >java++\nC >python++\nD >java+=3\nE >java\nF >rust';
    const nodes = parseTreeText(source);
    expect(nodes.map((node) => node.jumpIndex)).toEqual([2, 3, 1, 6, 6, 1]);
    expect(nodes.map((node) => node.title)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(nodes[3].originalText).toBe('D >java+=3');
  });

  it('does not interpret inline code or malformed references as jumps', () => {
    for (const text of ['Use `>java[2]`', 'Bad >java[abc]', 'Bad >java+=', 'Bad >java[2] tail']) {
      expect(parseTreeText(text)[0]).toMatchObject({ title: text, jumpLanguage: null });
    }
  });

  it('preserves unrelated source formatting, blank lines and jump operators when renaming', () => {
    const source = 'Root\r\n\tA >java++\r\n\r\n  B >java+=2\r\n';
    const child = parseTreeText(source)[0].children[0];
    expect(editTreeSource(source, { type: 'rename', node: child, value: 'Revised >java++' }))
      .toBe('Root\r\n\tRevised >java++\r\n\r\n  B >java+=2\r\n');
  });

  it('inserts children after their subtree and removes a subtree without deleting siblings', () => {
    const source = 'Root\n  A\n    Nested\n\nOther\n';
    const root = parseTreeText(source)[0];
    const added = editTreeSource(source, { type: 'add', node: root, value: 'B' });
    expect(added).toBe('Root\n  A\n    Nested\n  B\n\nOther\n');
    expect(editTreeSource(added, { type: 'delete', node: parseTreeText(added)[0].children[0] }))
      .toBe('Root\n  B\n\nOther\n');
    expect(flattenTree(parseTreeText(added))).toHaveLength(5);
  });

  it('creates a first root in an empty file and refuses empty renames', () => {
    expect(editTreeSource('', { type: 'add', value: 'Root' })).toBe('Root\n');
    expect(editTreeSource('Root', { type: 'rename', node: parseTreeText('Root')[0], value: '  ' })).toBe('Root');
    expect(getFileLanguage('MAP.MGTREE')).toBe('mgtree');
  });
});

describe('mgtree source highlighting', () => {
  it('highlights levels, inline code and jump syntax on the same line', () => {
    expect(tokenizeTreeLine('    Read `value` >java+=2')).toEqual([
      { startIndex: 0, scopes: 'mgtree.level3' },
      { startIndex: 9, scopes: 'mgtree.code' },
      { startIndex: 16, scopes: 'mgtree.level3' },
      { startIndex: 17, scopes: 'mgtree.jump' },
    ]);
  });

  it('uses unique ordered offsets at column one and highlights deep levels', () => {
    expect(tokenizeTreeLine('`code` >js++')[0]).toEqual({ startIndex: 0, scopes: 'mgtree.code' });
    expect(tokenizeTreeLine('>js[2]')).toEqual([{ startIndex: 0, scopes: 'mgtree.jump' }]);
    expect(tokenizeTreeLine('              Deep')[0].scopes).toBe('mgtree.level6');
    expect(tokenizeTreeLine('\tChild')[0].scopes).toBe('mgtree.level2');
  });
});
