function parseOutline(content) {
  const items = [];
  let inCodeBlock = false;
  let currentHeadingLevel = 0;
  for (const [index, line] of content.split('\n').entries()) {
    if (line.trimStart().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      currentHeadingLevel = heading[1].length;
      items.push({ type: 'heading', level: currentHeadingLevel, text: heading[2].replace(/[*_`~[\]]/g, '').trim(), line: index + 1 });
      continue;
    }
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)/);
    if (ordered) {
      items.push({ type: 'list-ordered', indent: Math.floor(ordered[1].length / 2), order: Number(ordered[2]), text: ordered[3].replace(/[*_`~[\]]/g, '').trim(), line: index + 1, parentLevel: currentHeadingLevel });
      continue;
    }
    const unordered = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (unordered) items.push({ type: 'list-unordered', indent: Math.floor(unordered[1].length / 2), text: unordered[2].replace(/[*_`~[\]]/g, '').trim(), line: index + 1, parentLevel: currentHeadingLevel });
  }
  return items;
}

function parseFootnotes(content) {
  const definitions = new Map();
  const definition = /^\[(\^[^\]]+)\]:\s*(.+(?:\n(?:    .+|\t.+))*)$/gm;
  let match;
  while ((match = definition.exec(content)) !== null) definitions.set(match[1].trim(), match[2].trim());
  const used = [];
  const seen = new Set();
  let processed = content.replace(definition, '').replace(/\[(\^[^\]]+)\]/g, (_full, id) => {
    const cleanId = id.substring(1).trim().replace(/\s+/g, '');
    if (!seen.has(id.trim())) { seen.add(id.trim()); used.push({ raw: id.trim(), cleanId }); }
    return `<a href="#fn-${cleanId}" id="fnref-${cleanId}" class="footnote-ref"><sup>[${cleanId}]</sup></a>`;
  });
  const items = used.filter((item) => definitions.has(item.raw)).map((item) => `<li><span id="fn-${item.cleanId}">${definitions.get(item.raw).replace(/\n/g, ' ').replace(/\s+/g, ' ')} <a href="#fnref-${item.cleanId}" class="footnote-backref">↩</a></span></li>`).join('\n');
  if (items) processed = `${processed.trim()}\n\n<div class="footnotes"><hr/><ol>\n${items}\n</ol></div>\n`;
  return processed;
}

self.onmessage = ({ data }) => {
  const { id, type, content = '' } = data || {};
  self.postMessage({ id, type, result: type === 'outline' ? parseOutline(content) : parseFootnotes(content) });
};
