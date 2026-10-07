import { problemPathKey } from '@store/useProblemsStore';

export const searchPathKey = (path) => problemPathKey(path || '');
export function relativeSearchPath(path, root = '') {
  const value = (path || '').replace(/\\/g, '/');
  const prefix = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return root && searchPathKey(value).startsWith(searchPathKey(root).replace(/\/$/, '') + '/') ? value.slice(prefix.length) : value;
}
export function isInSearchRoot(path, root) {
  return !root || Boolean(path && searchPathKey(path).startsWith(searchPathKey(root).replace(/\/$/, '') + '/'));
}
export function fileSearchScore(name, path, query, caseSensitive = false) {
  const normalize = (value) => caseSensitive ? value.replace(/\\/g, '/') : value.replace(/\\/g, '/').toLowerCase();
  name = normalize(name); path = normalize(path); query = normalize(query.trim());
  if (!query) return 0;
  const subsequence = (part) => {
    const wanted = [...part];
    let index = 0;
    for (const char of path) if (char === wanted[index]) index++;
    return index === wanted.length;
  };
  let rank;
  if (name === query) rank = 0;
  else if (name.startsWith(query)) rank = 1;
  else if (name.includes(query)) rank = 2;
  else if (path.includes(query)) rank = 3;
  else if (query.split(/\s+/).every(subsequence)) rank = 4;
  else return null;
  return rank * 10000 + Math.min([...name].length, 9999);
}

// 列号以 UTF-16 计算；大小写折叠的长度变化仍映射回原文位置。
export function textSearchRange(text, query, caseSensitive = false) {
  if (!query) return null;
  if (caseSensitive) {
    const start = text.indexOf(query);
    return start < 0 ? null : { start, length: query.length };
  }
  let folded = '', offset = 0;
  const starts = [], ends = [];
  for (const char of text) {
    const lower = char.toLowerCase();
    for (let i = 0; i < lower.length; i++) { starts.push(offset); ends.push(offset + char.length); }
    folded += lower; offset += char.length;
  }
  const needle = query.toLowerCase();
  const at = folded.indexOf(needle);
  return at < 0 ? null : { start: starts[at], length: ends[at + needle.length - 1] - starts[at] };
}
export function contentSearchResults(tab, text, query, caseSensitive, limit = 101) {
  const results = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const match = textSearchRange(lines[i], query, caseSensitive);
    if (!match) continue;
    const charsBefore = [...lines[i].slice(0, match.start)].length;
    const chars = [...lines[i]], from = Math.max(0, charsBefore - 50);
    results.push({ name: tab.name, path: tab.path, tabId: tab.id, source: 'open', modified: tab.modified,
      line_number: i + 1, column_number: match.start + 1, match_length: match.length,
      matched_line: `${from ? '…' : ''}${chars.slice(from, from + 180).join('')}${chars.length > from + 180 ? '…' : ''}` });
    if (results.length >= limit) break;
  }
  return results;
}
