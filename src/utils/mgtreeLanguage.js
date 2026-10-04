import { TREE_JUMP } from './mgtree';

export function tokenizeTreeLine(line) {
  const indent = line.match(/^[\t ]*/)[0].replace(/\t/g, '  ').length;
  const base = `mgtree.level${Math.min(6, Math.floor(indent / 2) + 1)}`;
  const tokens = [{ startIndex: 0, scopes: base }];
  const codeRanges = [];
  for (const match of line.matchAll(/`[^`]*`/g)) {
    codeRanges.push([match.index, match.index + match[0].length]);
    tokens.push({ startIndex: match.index, scopes: 'mgtree.code' });
    tokens.push({ startIndex: match.index + match[0].length, scopes: base });
  }
  const jump = line.match(TREE_JUMP);
  if (jump && !codeRanges.some(([start, end]) => jump.index >= start && jump.index < end)) {
    tokens.push({ startIndex: jump.index, scopes: 'mgtree.jump' });
  }
  // Monaco requires strictly increasing offsets, with the most specific token
  // winning when a code span or jump starts at column one.
  return [...new Map(tokens.map((token) => [token.startIndex, token])).values()]
    .filter((token) => token.startIndex < line.length || token.startIndex === 0)
    .sort((a, b) => a.startIndex - b.startIndex);
}

export function treeTokenRules(dark) {
  const colors = dark
    ? ['E9A4AC', 'E3C281', '83B7F5', 'DCA57C', 'B9A0E9', '77C5C1']
    : ['B34D63', '96691D', '326CBC', 'A36539', '7959AF', '287D7A'];
  return [
    ...colors.map((foreground, index) => ({ token: `mgtree.level${index + 1}`, foreground })),
    { token: 'mgtree.code', foreground: dark ? '91C99D' : '38794B' },
    { token: 'mgtree.jump', foreground: dark ? 'C4A4F4' : '8452BF', fontStyle: 'bold' },
  ];
}

export function registerMgtreeLanguage(monaco) {
  if (monaco.languages.getLanguages().some(({ id }) => id === 'mgtree')) return;
  monaco.languages.register({ id: 'mgtree', extensions: ['.mgtree'], aliases: ['MgTree'] });
  const state = { clone() { return this; }, equals(other) { return other === this; } };
  monaco.languages.setTokensProvider('mgtree', {
    getInitialState: () => state,
    tokenize: (line) => ({ tokens: tokenizeTreeLine(line), endState: state }),
  });
  monaco.languages.setLanguageConfiguration('mgtree', {
    brackets: [['[', ']']],
    autoClosingPairs: [{ open: '`', close: '`' }, { open: '[', close: ']' }],
    surroundingPairs: [{ open: '`', close: '`' }, { open: '[', close: ']' }],
    folding: { offSide: true },
  });
}
