import { expect, it } from 'vitest';
import { sortDirectoryContents } from './directoryContents';

it('keeps directories first, uses numeric names and leaves the input unchanged', () => {
  const source = [{ name: 'file10' }, { name: 'file2', is_dir: false }, { name: 'folder', is_dir: true }];
  expect(sortDirectoryContents(source).map((item) => item.name)).toEqual(['folder', 'file2', 'file10']);
  expect(source[0].name).toBe('file10');
  expect(sortDirectoryContents(source, { sortOrder: 'desc' }).map((item) => item.name)).toEqual(['folder', 'file10', 'file2']);
});

it.each(['size', 'time'])('sorts by %s with numeric name tie breaking', (sortBy) => {
  const source = [{ name: 'n10', size: 1, modified: 1 }, { name: 'n2', size: 1, modified: 1 }, { name: 'n1', size: 5, modified: 5 }];
  expect(sortDirectoryContents(source, { sortBy }).map((item) => item.name)).toEqual(['n2', 'n10', 'n1']);
});
