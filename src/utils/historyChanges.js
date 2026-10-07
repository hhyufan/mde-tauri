/** Restore selected lines/blocks while preserving every other current-file change. */
export function restoreSelectedHistoryChanges(
  original,
  modified,
  changes,
  selection,
  side = 'modified',
) {
  if (!selection || !changes?.length) return modified;
  const originalLines = original.split(/\r\n|\r|\n/);
  const modifiedLines = modified.split(/\r\n|\r|\n/);
  const eol = modified.includes('\r\n') ? '\r\n' : modified.includes('\r') ? '\r' : '\n';
  const selectedStart = selection.startLineNumber;
  // A selection ending at column 1 excludes that final line.
  const selectedEnd =
    selection.endLineNumber > selectedStart && selection.endColumn === 1
      ? selection.endLineNumber - 1
      : selection.endLineNumber;
  const edits = [];
  for (const change of changes) {
    const os = change.originalStartLineNumber,
      oe = change.originalEndLineNumber;
    const ms = change.modifiedStartLineNumber,
      me = change.modifiedEndLineNumber;
    const start = side === 'original' ? os : ms;
    const end = side === 'original' ? oe : me;
    const anchor = end === 0 ? Math.max(1, start) : start;
    const from = Math.max(selectedStart, anchor);
    const to = Math.min(selectedEnd, end === 0 ? anchor : end);
    if (from > to) continue;
    const originalCount = oe === 0 ? 0 : oe - os + 1;
    const modifiedCount = me === 0 ? 0 : me - ms + 1;
    if (originalCount === modifiedCount && originalCount > 0) {
      const offset = from - start,
        count = to - from + 1;
      edits.push({
        at: ms - 1 + offset,
        count,
        lines: originalLines.slice(os - 1 + offset, os - 1 + offset + count),
      });
    } else if (modifiedCount === 0 && side === 'original') {
      edits.push({ at: ms, count: 0, lines: originalLines.slice(from - 1, to) });
    } else if (originalCount === 0 && side === 'modified') {
      edits.push({ at: from - 1, count: to - from + 1, lines: [] });
    } else {
      edits.push({
        at: me === 0 ? ms : ms - 1,
        count: modifiedCount,
        lines: oe === 0 ? [] : originalLines.slice(os - 1, oe),
      });
    }
  }
  if (edits.length === 0) return modified;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    modifiedLines.splice(edit.at, edit.count, ...edit.lines);
  return modifiedLines.join(eol);
}
