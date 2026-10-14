import { expect, it } from 'vitest';
import {
  codeToLabel,
  formatKeybinding,
  hasModifier,
  isModifierCode,
  keybindingFromEvent,
  matchesKeybinding,
  parseKeybinding,
  validateKeybinding,
} from './keybinding';

/** 构造一个最小键盘事件。 */
function event(init) {
  return {
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
  };
}

it('builds a modifier-ordered keybinding from an event', () => {
  expect(keybindingFromEvent(event({ code: 'KeyS', ctrlKey: true }))).toBe('Ctrl+KeyS');
  expect(keybindingFromEvent(event({ code: 'KeyA', shiftKey: true, ctrlKey: true, altKey: true })))
    .toBe('Ctrl+Alt+Shift+KeyA');
  expect(keybindingFromEvent(event({ code: 'F11' }))).toBe('F11');
});

it('ignores modifier-only presses', () => {
  expect(keybindingFromEvent(event({ code: 'ShiftLeft', shiftKey: true }))).toBe('');
  expect(keybindingFromEvent(event({ code: 'ControlRight', ctrlKey: true }))).toBe('');
  expect(keybindingFromEvent(undefined)).toBe('');
  expect(keybindingFromEvent({})).toBe('');
  expect(isModifierCode('ShiftLeft')).toBe(true);
  expect(isModifierCode('KeyS')).toBe(false);
});

it('matches the physical key, so Ctrl+Shift+/ works on a US layout', () => {
  // The bug: with Shift held, `key` is '?' on US layouts, so comparing `key`
  // never matched. `code` stays 'Slash' regardless of layout or Shift.
  const withShift = event({ code: 'Slash', ctrlKey: true, shiftKey: true, key: '?' });
  expect(matchesKeybinding(withShift, 'Ctrl+Shift+Slash')).toBe(true);
  // Comparing the typed character must NOT be how this is implemented.
  expect(withShift.key).toBe('?');
});

it('does not match a different modifier set', () => {
  expect(matchesKeybinding(event({ code: 'Slash', ctrlKey: true }), 'Ctrl+Shift+Slash')).toBe(false);
  expect(matchesKeybinding(event({ code: 'KeyS', ctrlKey: true }), 'Ctrl+KeyO')).toBe(false);
  expect(matchesKeybinding(event({ code: 'KeyS', ctrlKey: true }), '')).toBe(false);
});

it('parses keybindings with modifiers in canonical order', () => {
  expect(parseKeybinding('Ctrl+Shift+Slash')).toEqual({ modifiers: ['Ctrl', 'Shift'], code: 'Slash' });
  expect(parseKeybinding('Shift+Ctrl+Slash')).toEqual({ modifiers: ['Ctrl', 'Shift'], code: 'Slash' });
  expect(parseKeybinding('F11')).toEqual({ modifiers: [], code: 'F11' });
  expect(parseKeybinding('')).toEqual({ modifiers: [], code: '' });
  expect(parseKeybinding(undefined)).toEqual({ modifiers: [], code: '' });
});

it('reports whether a binding carries a modifier', () => {
  expect(hasModifier('Ctrl+KeyS')).toBe(true);
  expect(hasModifier('Meta+KeyS')).toBe(true);
  expect(hasModifier('Shift+Slash')).toBe(false);
  expect(hasModifier('F11')).toBe(false);
});

it('rejects bindings that would break typing or system editing', () => {
  expect(validateKeybinding('Ctrl+KeyS')).toEqual({ ok: true });
  expect(validateKeybinding('F11')).toEqual({ ok: true });
  expect(validateKeybinding('')).toEqual({ ok: false, reason: 'empty' });
  expect(validateKeybinding('ControlLeft')).toEqual({ ok: false, reason: 'modifierOnly' });
  expect(validateKeybinding('KeyS')).toEqual({ ok: false, reason: 'needsModifier' });
  expect(validateKeybinding('Slash')).toEqual({ ok: false, reason: 'needsModifier' });
  // Reserved clipboard/selection combinations must stay usable in inputs.
  expect(validateKeybinding('Ctrl+KeyC')).toEqual({ ok: false, reason: 'reserved' });
  expect(validateKeybinding('Ctrl+KeyV')).toEqual({ ok: false, reason: 'reserved' });
  expect(validateKeybinding('Ctrl+KeyX')).toEqual({ ok: false, reason: 'reserved' });
  expect(validateKeybinding('Ctrl+KeyA')).toEqual({ ok: false, reason: 'reserved' });
  // Function keys are allowed without a modifier.
  expect(validateKeybinding('F1')).toEqual({ ok: true });
});

it('labels codes in a human-readable way', () => {
  expect(codeToLabel('Slash')).toBe('/');
  expect(codeToLabel('KeyS')).toBe('S');
  expect(codeToLabel('Digit1')).toBe('1');
  expect(codeToLabel('ArrowUp')).toBe('↑');
  expect(codeToLabel('F11')).toBe('F11');
  expect(codeToLabel('')).toBe('');
});

it('formats for display, switching to macOS symbols', () => {
  expect(formatKeybinding('Ctrl+Shift+Slash')).toBe('Ctrl+Shift+/');
  expect(formatKeybinding('Ctrl+Shift+Slash', true)).toBe('⌘⇧/');
  expect(formatKeybinding('Ctrl+Comma')).toBe('Ctrl+,');
  expect(formatKeybinding('Ctrl+Comma', true)).toBe('⌘,');
  expect(formatKeybinding('F11')).toBe('F11');
  expect(formatKeybinding('')).toBe('');
});
