import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

const selectors =
  '[data-moki-tooltip], .milkdown-code-block .copy-button, .milkdown-code-block .language-button, .milkdown-code-block .preview-toggle-button, .md-preview__html-block-preview, [data-type="math_inline"], [data-type="math_block"]';

// Milkdown owns these node views (including Vue controls). Delegate events and
// anchor Antd to a portal rather than wrapping or replacing ProseMirror DOM.
export default function MilkdownTooltips({ rootRef, readOnly }) {
  const { t } = useTranslation();
  const id = useId();
  const [tip, setTip] = useState(null);
  const hovered = useRef(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let timer;
    const hide = () => {
      clearTimeout(timer);
      hovered.current = null;
      setTip(null);
    };
    const label = (element) => {
      if (element.dataset.mokiTooltip) return element.dataset.mokiTooltip;
      if (element.matches('.copy-button')) return t('editor.copyCode');
      if (element.matches('.language-button')) return t('editor.chooseCodeLanguage');
      if (element.matches('.preview-toggle-button'))
        return t(
          element.closest('.milkdown-code-block')?.querySelector('.codemirror-host.hidden')
            ? 'editor.showCode'
            : 'editor.showPreview',
        );
      if (!readOnly && element.matches('.md-preview__html-block-preview'))
        return t('editor.editHtmlHint');
      if (!readOnly && element.matches('[data-type="math_inline"], [data-type="math_block"]'))
        return t('editor.editMathHint');
      return '';
    };
    const show = (event) => {
      const element = event.target.closest?.(selectors);
      if (!element || !root.contains(element) || element.disabled || element.closest('[hidden]'))
        return;
      if (hovered.current === element) return;
      hide();
      const title = label(element);
      if (!title) return;
      hovered.current = element;
      timer = setTimeout(
        () => {
          if (!element.isConnected) return;
          const box = element.getBoundingClientRect();
          setTip({
            element,
            title,
            rect: { left: box.left, top: box.top, width: box.width, height: box.height },
          });
        },
        event.type === 'focusin' ? 0 : 300,
      );
    };
    const leave = (event) => {
      if (event.relatedTarget instanceof Node && hovered.current?.contains(event.relatedTarget))
        return;
      hide();
    };
    const annotate = (node) => {
      if (!(node instanceof Element)) return;
      const controls = [
        ...node.querySelectorAll('.copy-button, .language-button, .preview-toggle-button'),
      ];
      if (node.matches('.copy-button, .language-button, .preview-toggle-button'))
        controls.push(node);
      for (const element of controls) element.setAttribute('aria-label', label(element));
    };
    annotate(root);
    const observer = new MutationObserver((records) => {
      if (hovered.current && !hovered.current.isConnected) hide();
      for (const record of records) for (const node of record.addedNodes) annotate(node);
    });
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('mouseover', show);
    root.addEventListener('mouseout', leave);
    root.addEventListener('focusin', show);
    root.addEventListener('focusout', leave);
    root.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      root.removeEventListener('mouseover', show);
      root.removeEventListener('mouseout', leave);
      root.removeEventListener('focusin', show);
      root.removeEventListener('focusout', leave);
      root.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [rootRef, readOnly, t]);
  useEffect(() => {
    const element = tip?.element;
    if (!element) return undefined;
    const previous = element.getAttribute('aria-describedby');
    element.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
    return () => {
      if (previous) element.setAttribute('aria-describedby', previous);
      else element.removeAttribute('aria-describedby');
    };
  }, [tip, id]);
  if (!tip) return null;
  return createPortal(
    <Tooltip id={id} open title={tip.title} placement="top" trigger={[]} destroyOnHidden>
      <span
        aria-hidden="true"
        style={{ position: 'fixed', ...tip.rect, pointerEvents: 'none', zIndex: -1 }}
      />
    </Tooltip>,
    document.body,
  );
}
