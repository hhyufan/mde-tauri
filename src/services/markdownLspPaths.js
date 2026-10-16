// Marksman uses workspace-rooted Markdown paths; the editor opens local files.
// Keep that translation here so completion and link navigation agree.
const encodePath = (value) => value.split('/').map(encodeURIComponent).join('/');
const decodePath = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
function insideCode(text) {
  let opened = 0;
  for (const match of text.matchAll(/(?<!\\)`+/g)) {
    if (!opened) opened = match[0].length;
    else if (opened === match[0].length) opened = 0;
  }
  return Boolean(opened);
}

export function markdownLinkContext(model, position) {
  const lines = model.getValue().split(/\r?\n/);
  const line = lines[position.lineNumber - 1] || '';
  const cursor = position.column - 1;
  const match = line.slice(0, cursor).match(/!?\[[^\]\n]*\]\(\s*(<?)([^)>\n]*)$/);
  if (!match) return null;
  if (insideCode(line.slice(0, match.index))) return null;
  const prefix = match[2];
  if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(prefix) || /[?#]/.test(prefix)) return null;
  let fence = null;
  for (const previous of lines.slice(0, position.lineNumber - 1)) {
    const marker = previous.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!marker) continue;
    if (!fence) fence = marker[1];
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
  }
  if (fence) return null;
  const lastSlash = prefix.lastIndexOf('/');
  const directory =
    prefix === '.'
      ? './'
      : prefix === '..'
        ? '../'
        : lastSlash >= 0
          ? prefix.slice(0, lastSlash + 1)
          : './';
  const partial = prefix === '.' || prefix === '..' ? '' : prefix.slice(lastSlash + 1);
  const tail = line.slice(cursor).match(match[1] ? /^[^>\n]*/ : /^[^\s)\n]*/)?.[0] || '';
  return {
    prefix,
    directory,
    partial,
    range: {
      start: { line: position.lineNumber - 1, character: cursor - prefix.length },
      end: { line: position.lineNumber - 1, character: cursor + tail.length },
    },
  };
}

export function relativeMarkdownPath(value, document) {
  if (!value.startsWith('/') || value.startsWith('//')) return value;
  const root = new URL(document.rootUri);
  root.pathname = root.pathname.replace(/\/?$/, '/');
  const target = new URL(value.slice(1), root);
  const current = new URL(document.uri);
  if (target.host !== current.host) return value;
  const from = decodeURIComponent(current.pathname).split('/').slice(0, -1);
  const to = decodeURIComponent(target.pathname).split('/');
  const windows =
    /^\/[a-z]:\//i.test(decodeURIComponent(current.pathname)) || Boolean(current.host);
  let common = 0;
  while (
    common < from.length &&
    common < to.length &&
    (windows
      ? from[common].toLowerCase() === to[common].toLowerCase()
      : from[common] === to[common])
  )
    common++;
  const relative = [
    ...from.slice(common).map(() => '..'),
    ...to.slice(common).map(encodeURIComponent),
  ].join('/');
  return `${relative.startsWith('../') ? '' : './'}${relative}${target.search}${target.hash}`;
}

export function normalizeMarkdownPathItems(items, document, context) {
  if (!context) return items;
  return items.flatMap((item) => {
    const original = item.textEdit?.newText ?? item.insertText;
    if (typeof original !== 'string') return [item];
    let path;
    try {
      path = relativeMarkdownPath(original, document);
    } catch {
      return [];
    }
    // Dot paths describe one actual directory, rather than a workspace-wide search.
    const decoded = decodePath(path),
      directory = decodePath(context.directory);
    if (!decoded.startsWith(directory)) return [];
    const remaining = decoded.slice(directory.length);
    if (
      remaining.includes('/') ||
      !remaining.toLowerCase().startsWith(decodePath(context.partial).toLowerCase())
    )
      return [];
    return [
      {
        ...item,
        label: decodeURIComponent(path),
        filterText: context.prefix.includes('%') ? path : decodePath(path),
        textEdit: { range: context.range, newText: path },
      },
    ];
  });
}

export function fileUriPath(value) {
  const uri = new URL(value);
  const path = decodeURIComponent(uri.pathname);
  if (uri.hostname) return `//${uri.hostname}${path}`;
  return path.replace(/^\/([a-z]:\/)/i, '$1');
}

export async function markdownDirectoryItems(context, document, readDirectory) {
  if (!context) return [];
  try {
    const folder = new URL(context.directory, document.uri);
    const entries = await readDirectory(fileUriPath(folder.href));
    const parent = context.directory === './' ? '../' : `${context.directory}../`;
    const items = (Array.isArray(entries) ? entries : []).filter(
      (entry) =>
        entry.name &&
        entry.name !== '.' &&
        entry.name !== '..' &&
        (entry.name.toLowerCase().startsWith(decodePath(context.partial).toLowerCase()) ||
          encodeURIComponent(entry.name).toLowerCase().startsWith(context.partial.toLowerCase())),
    );
    const completion = (path, name, folder) => ({
      label: `${context.directory}${name}${folder ? '/' : ''}`,
      kind: folder ? 19 : 17,
      filterText: context.prefix.includes('%') ? path : decodePath(path),
      sortText: `${folder ? '0' : '1'}${name}`,
      textEdit: { range: context.range, newText: path },
      ...(folder
        ? { mokiCommand: { id: 'editor.action.triggerSuggest', title: '继续选择路径' } }
        : {}),
    });
    return [
      ...(!context.partial ? [{ ...completion(parent, '..', true), label: parent }] : []),
      ...items.map((entry) =>
        completion(
          `${context.directory}${encodePath(entry.name)}${entry.is_dir ? '/' : ''}`,
          entry.name,
          entry.is_dir,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function markdownDocumentLinks(source, uri) {
  const links = [];
  const lines = source.split(/\r?\n/);
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    for (const match of lines[index].matchAll(
      /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    )) {
      const path = match[1] || match[2];
      if (path === '.' || path === '..' || path.endsWith('/')) continue;
      if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(path)) continue;
      const column = match.index + match[0].indexOf(path);
      if (insideCode(lines[index].slice(0, match.index))) continue;
      try {
        links.push({
          range: {
            startLineNumber: index + 1,
            startColumn: column + 1,
            endLineNumber: index + 1,
            endColumn: column + path.length + 1,
          },
          url: new URL(path, uri).href,
        });
      } catch {
        /* Invalid link. */
      }
    }
  }
  return links;
}
