import { expect, it, vi } from 'vitest';
import {
  markdownLinkContext,
  relativeMarkdownPath,
  normalizeMarkdownPathItems,
  markdownDirectoryItems,
  markdownDocumentLinks,
} from './markdownLspPaths';
import { resolveMarkdownLinkPath } from '@utils/markdownAssets';

const document = { uri: 'file:///C:/workspace/sub/main.md', rootUri: 'file:///C:/workspace' };
function context(prefix, suffix = ')') {
  const source = `[Read](${prefix}${suffix}`;
  return markdownLinkContext(
    { getValue: () => source },
    { lineNumber: 1, column: 8 + prefix.length },
  );
}
it('turns workspace-rooted Marksman paths into portable document-relative links', () => {
  expect(relativeMarkdownPath('/sub/notes.md', document)).toBe('./notes.md');
  expect(relativeMarkdownPath('/parent.md', document)).toBe('../parent.md');
  expect(relativeMarkdownPath('/sub/a%20b%23c.md#summary', document)).toBe(
    './a%20b%23c.md#summary',
  );
  expect(
    relativeMarkdownPath('/sub/notes.md', {
      ...document,
      uri: 'file:///c%3A/workspace/sub/main.md',
    }),
  ).toBe('./notes.md');
});
it.each(['.', './', '..', '../'])(
  'uses the correct listing and replace range for %s',
  async (prefix) => {
    const read = vi.fn(async () => [
      { name: 'notes.md', is_dir: false },
      { name: 'child', is_dir: true },
    ]);
    const ctx = context(prefix);
    const items = await markdownDirectoryItems(ctx, document, read);
    expect(read).toHaveBeenCalledWith(
      prefix.startsWith('..') ? 'C:/workspace/' : 'C:/workspace/sub/',
    );
    const path = prefix.startsWith('..') ? '../notes.md' : './notes.md';
    expect(items.find((item) => item.textEdit.newText === path)).toBeTruthy();
    const folder = items.find((item) => item.textEdit.newText.endsWith('child/'));
    expect(folder.mokiCommand.id).toBe('editor.action.triggerSuggest');
    expect(ctx.range).toEqual({
      start: { line: 0, character: 7 },
      end: { line: 0, character: 7 + prefix.length },
    });
  },
);
it('filters each dot-directory and replaces an existing path suffix, not just the last word', () => {
  const items = ['/sub/notes.md', '/parent.md', '/sub/child/nested.md'].map((path) => ({
    label: path,
    textEdit: { newText: path },
  }));
  expect(normalizeMarkdownPathItems(items, document, context('./'))).toMatchObject([
    { textEdit: { newText: './notes.md' } },
  ]);
  expect(normalizeMarkdownPathItems(items, document, context('../'))).toMatchObject([
    { textEdit: { newText: '../parent.md' } },
  ]);
  const ctx = context('./n', 'otes.md)');
  expect(normalizeMarkdownPathItems(items, document, ctx)[0].textEdit.range.end.character).toBe(17);
});
it('encodes filenames once and opens accepted sibling and parent links on the same paths', async () => {
  const items = await markdownDirectoryItems(context('./'), document, async () => [
    { name: '中文 #笔记.md', is_dir: false },
  ]);
  const link = items.find((item) => item.kind === 17).textEdit.newText;
  expect(link).toBe('./%E4%B8%AD%E6%96%87%20%23%E7%AC%94%E8%AE%B0.md');
  expect(resolveMarkdownLinkPath(link, 'C:/workspace/sub/main.md').path).toBe(
    'C:/workspace/sub/中文 #笔记.md',
  );
  expect(resolveMarkdownLinkPath('../parent.md', 'C:/workspace/sub/main.md').path).toBe(
    'C:/workspace/parent.md',
  );
  expect(
    await markdownDirectoryItems(context('./中'), document, async () => [
      { name: '中文.md', is_dir: false },
    ]),
  ).toHaveLength(1);
});
it('registers clickable relative file links without treating code examples or external links as files', () => {
  expect(markdownDocumentLinks('[folder](./) [parent](../)', document.uri)).toEqual([]);
  const links = markdownDocumentLinks(
    '[a](./notes.md)\n[b](../parent.md)\n`[code](./skip.md)`\n```md\n[fenced](./skip.md)\n```\n[web](https://example.com)',
    document.uri,
  );
  expect(links.map((link) => link.url)).toEqual([
    'file:///C:/workspace/sub/notes.md',
    'file:///C:/workspace/parent.md',
  ]);
  expect(
    markdownLinkContext({ getValue: () => '`[code](./`' }, { lineNumber: 1, column: 11 }),
  ).toBeNull();
});
