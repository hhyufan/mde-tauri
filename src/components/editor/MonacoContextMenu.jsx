import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './monaco-context-menu.scss';

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const Mod = isMac ? '\u2318' : 'Ctrl';

export default function MonacoContextMenu({ visible, x, y, onClose, editorRef }) {
  const { t } = useTranslation();
  const menuRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const trigger = (actionId) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    const editor = editorRef.current;
    if (!editor) return;
    editor.trigger('contextmenu', actionId, null);
    setTimeout(() => editor.focus(), 50);
  };

  const items = [
    { key: 'undo', label: t('editor.menu.undo'), shortcut: `${Mod}+Z`, action: trigger('undo') },
    { key: 'redo', label: t('editor.menu.redo'), shortcut: `${Mod}+Y`, action: trigger('redo') },
    { key: 's1', type: 'separator' },
    { key: 'cut', label: t('editor.menu.cut'), shortcut: `${Mod}+X`, action: trigger('editor.action.clipboardCutAction') },
    { key: 'copy', label: t('editor.menu.copy'), shortcut: `${Mod}+C`, action: trigger('editor.action.clipboardCopyAction') },
    { key: 'paste', label: t('editor.menu.paste'), shortcut: `${Mod}+V`, action: trigger('editor.action.clipboardPasteAction') },
    { key: 's2', type: 'separator' },
    { key: 'selectAll', label: t('editor.menu.selectAll'), shortcut: `${Mod}+A`, action: trigger('editor.action.selectAll') },
    { key: 's3', type: 'separator' },
    { key: 'find', label: t('editor.menu.find'), shortcut: `${Mod}+F`, action: trigger('actions.find') },
    { key: 'replace', label: t('editor.menu.replace'), shortcut: `${Mod}+H`, action: trigger('editor.action.startFindReplaceAction') },
    { key: 's4', type: 'separator' },
    { key: 'changeAll', label: t('editor.menu.changeAllOccurrences'), shortcut: `${Mod}+F2`, action: trigger('editor.action.changeAll') },
    { key: 'format', label: t('editor.menu.formatDocument'), shortcut: `${Mod}+Shift+F`, action: trigger('editor.action.formatDocument') },
    { key: 's5', type: 'separator' },
    { key: 'cmd', label: t('editor.menu.commandPalette'), shortcut: 'F1', action: trigger('editor.action.quickCommand') },
  ];

  return createPortal(
    <div ref={menuRef} className="monaco-context-menu" style={{ top: y, left: x }}>
      {items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.key} className="monaco-context-menu__sep" />;
        }
        return (
          <div key={item.key} className="monaco-context-menu__item" onMouseDown={item.action}>
            <span className="monaco-context-menu__label">{item.label}</span>
            <span className="monaco-context-menu__shortcut">{item.shortcut}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
