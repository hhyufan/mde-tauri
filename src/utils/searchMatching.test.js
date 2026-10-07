import { expect, it } from 'vitest';
import { contentSearchResults, fileSearchScore, isInSearchRoot, relativeSearchPath, textSearchRange } from './searchMatching';

it('matches filename, mixed path separators, spaced fuzzy tokens and dotfiles', () => {
  expect(fileSearchScore('.env', '.env', '.env')).not.toBeNull();
  expect(fileSearchScore('MonacoEditor.jsx', 'src/MonacoEditor.jsx', 'src\\mejsx')).not.toBeNull();
  expect(fileSearchScore('MonacoEditor.jsx', 'src/MonacoEditor.jsx', 'src med')).not.toBeNull();
  expect(fileSearchScore('MonacoEditor.jsx', 'src/MonacoEditor.jsx', 'unknown')).toBeNull();
  expect(fileSearchScore('foo', 'foo', 'foo')).toBeLessThan(fileSearchScore('prefix-foo', 'prefix-foo', 'foo'));
  expect(fileSearchScore('README.md', 'README.md', 'read', true)).toBeNull();
});
it('keeps project boundaries and handles Windows casing and Unix paths', () => {
  expect(isInSearchRoot('C:\\PROJECT\\src\\a.kt', 'c:/project')).toBe(true);
  expect(isInSearchRoot('C:/project-other/a.kt', 'C:/project')).toBe(false);
  expect(relativeSearchPath('C:\\PROJECT\\src\\a.kt', 'c:/project')).toBe('src/a.kt');
  expect(relativeSearchPath('/project/src/a.kt', '/project')).toBe('src/a.kt');
  expect(isInSearchRoot('/Project/a', '/project')).toBe(false);
});
it('finds Unicode text without slicing a character and keeps UTF-16 line/column ranges', () => {
  expect(textSearchRange('İxx😀Needle', 'needle')).toEqual({ start: 5, length: 6 });
  const text = 'first\r\n' + '文'.repeat(160) + '😀Needle' + '文'.repeat(200);
  const result = contentSearchResults({ id: 'tab', path: 'a.kt', name: 'a.kt' }, text, 'needle', false)[0];
  expect(result).toMatchObject({ line_number: 2, column_number: 163, match_length: 6 });
  expect(result.matched_line).toContain('Needle');
  expect(result.matched_line).not.toContain('�');
  expect(contentSearchResults({ id: 'tab', name: 'a.kt' }, text, 'needle', true)).toEqual([]);
});
