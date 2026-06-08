/**
 * 解析 Markdown 中的脚注引用与定义。
 *
 * 返回 `{ content }`，其中内联 `[^id]` 会被替换成可跳转锚点，文末则追加
 * 一段统一的脚注列表 HTML。
 */
/**
 * ?? Markdown ??????????????? HTML ???
 */
export function parseFootnotes(content) {
  if (!content) return { content: '' };

  const definitions = new Map();
  // 支持多行脚注定义，后续缩进内容会被并入同一条脚注正文。
  const defRe = /^\[(\^[^\]]+)\]:\s*(.+(?:\n(?:    .+|\t.+))*)$/gm;
  let m;
  while ((m = defRe.exec(content)) !== null) {
    definitions.set(m[1].trim(), m[2].trim());
  }

  let processed = content.replace(defRe, '');

  const usedRefs = [];
  const seen = new Set();

  processed = processed.replace(/\[(\^[^\]]+)\]/g, (full, id) => {
    // 同一个脚注引用只在脚注列表中生成一次，避免重复条目。
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
 * 预览 DOM 渲染完成后，为脚注锚点补充平滑滚动跳转行为。
 */
/**
 * ?????????????????????????
 */
export function addFootnoteJumpHandlers(container) {
  if (!container) return;

  // 采用事件委托，并通过 data 标记避免重复绑定监听器。
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
