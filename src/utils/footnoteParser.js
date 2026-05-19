/**
 * Parse [^id] references and [^id]: definitions in Markdown text.
 * Returns { content } where content has inline refs replaced with
 * anchor HTML and a footnotes section appended at the bottom.
 */
export function parseFootnotes(content) {
  if (!content) return { content: '' };

  const definitions = new Map();
  const defRe = /^\[(\^[^\]]+)\]:\s*(.+(?:\n(?:    .+|\t.+))*)$/gm;
  let m;
  while ((m = defRe.exec(content)) !== null) {
    definitions.set(m[1].trim(), m[2].trim());
  }

  let processed = content.replace(defRe, '');

  const usedRefs = [];
  const seen = new Set();

  processed = processed.replace(/\[(\^[^\]]+)\]/g, (full, id) => {
    const cleanId = id.substring(1).trim().replace(/\s+/g, '');
    const refId = `fnref-${cleanId}`;
    const targetId = `fn-${cleanId}`;
    if (!seen.has(id.trim())) {
      seen.add(id.trim());
      usedRefs.push({ raw: id.trim(), cleanId, refId, targetId });
    }
    return `<a href="#${targetId}" id="${refId}" class="footnote-ref"><sup>[${cleanId}]</sup></a>`;
  });

  if (usedRefs.length > 0) {
    const items = usedRefs
      .filter((r) => definitions.has(r.raw))
      .map((r) => {
        const text = definitions.get(r.raw).replace(/\n/g, ' ').replace(/\s+/g, ' ');
        return `<li><span id="${r.targetId}">${text} <a href="#${r.refId}" class="footnote-backref">↩</a></span></li>`;
      })
      .join('\n');

    if (items) {
      processed = processed.trim() + `\n\n<div class="footnotes"><hr/><ol>\n${items}\n</ol></div>\n`;
    }
  }

  return { content: processed };
}

/**
 * After the preview DOM is rendered, wire click handlers on
 * footnote anchors so they scroll to their targets.
 */
export function addFootnoteJumpHandlers(container) {
  if (!container) return;

  if (container.dataset.footnoteDelegatedHandler) return;
  container.dataset.footnoteDelegatedHandler = '1';
  container.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[href^="#fn"]');
    if (!link || !container.contains(link)) return;

    e.preventDefault();
    e.stopPropagation();

    const href = link.getAttribute('href');
    const target = href ? container.querySelector(`#${CSS.escape(href.slice(1))}`) : null;
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('footnote-highlight');
    window.setTimeout(() => target.classList.remove('footnote-highlight'), 1200);
  });
}
