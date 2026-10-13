// Reuse the collator instead of constructing one for every comparison in a
// directory sort. Directories remain first regardless of the sort direction.
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortDirectoryContents(contents, { sortBy = 'name', sortOrder = 'asc' } = {}) {
  const direction = sortOrder === 'desc' ? -1 : 1;
  return [...contents].sort((a, b) => {
    if (Boolean(a.is_dir) !== Boolean(b.is_dir)) return a.is_dir ? -1 : 1;
    let value = 0;
    if (sortBy === 'size') value = (a.size || 0) - (b.size || 0);
    else if (sortBy === 'time') value = (a.modified || 0) - (b.modified || 0);
    return (value || names.compare(a.name, b.name)) * direction;
  });
}
