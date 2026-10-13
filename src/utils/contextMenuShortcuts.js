export const MENU_MOD = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function matchesMenuShortcut(event, shortcut) {
  if (!shortcut || event.isComposing || event.keyCode === 229) return false;
  const parts = shortcut.replace('⌘', 'Meta').split('+');
  return event.key.toLowerCase() === parts.at(-1).toLowerCase()
    && event.ctrlKey === parts.includes('Ctrl') && event.metaKey === parts.includes('Meta')
    && event.shiftKey === parts.includes('Shift') && event.altKey === parts.includes('Alt');
}
