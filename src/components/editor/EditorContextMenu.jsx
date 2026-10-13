import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import useToastStore from '@store/useToastStore';
import { matchesMenuShortcut } from '@utils/contextMenuShortcuts';
import './monaco-context-menu.scss';

export default function EditorContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const { t } = useTranslation();
  const activate = useCallback(async (item) => {
    onClose();
    try { await item.run(); }
    catch { useToastStore.getState().toast(t('editor.menu.actionFailed')); }
  }, [onClose, t]);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const element = ref.current;
    const box = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8))}px`;
  }, [menu]);
  useEffect(() => {
    if (!menu) return undefined;
    const previousFocus = document.activeElement;
    const outside = (event) => { if (!ref.current?.contains(event.target)) onClose(); };
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); previousFocus?.focus?.(); return; }
      const item = menu.items.find((entry) => matchesMenuShortcut(event, entry.shortcut));
      if (item) {
        event.preventDefault(); event.stopPropagation();
        if (!item.disabled) activate(item);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0)
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [menu, onClose, activate]);
  if (!menu) return null;
  return createPortal(<div ref={ref} className="monaco-context-menu editor-context-menu" role="menu"
    aria-label={t(`editor.menu.${menu.variant}`)} data-menu-variant={menu.variant}
    style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
    {menu.items.map((item) => item.separator
      ? <div key={item.key} className="monaco-context-menu__sep" role="separator" />
      : <button key={item.key} role="menuitem" type="button" disabled={item.disabled}
        aria-label={item.label} aria-keyshortcuts={item.shortcut?.replace('⌘', 'Meta').replace('Ctrl', 'Control')}
        className={`monaco-context-menu__item editor-context-menu__item${item.danger ? ' is-danger' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => activate(item)}>
        <span className="monaco-context-menu__label">{item.label}</span>
        {item.shortcut && <span className="monaco-context-menu__shortcut">{item.shortcut}</span>}
      </button>)}
  </div>, document.body);
}
