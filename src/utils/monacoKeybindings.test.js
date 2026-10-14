import { expect, it } from 'vitest';
import { toMonacoKeybinding } from './monacoKeybindings';

/** 与 monaco-editor 0.52 实际枚举值一致的桩对象。 */
const monaco = {
  KeyCode: { Slash: 90, KeyS: 49, KeyI: 39, Comma: 82, F11: 88 },
  KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
};

it('maps a plain modifier combination', () => {
  expect(toMonacoKeybinding(monaco, 'Ctrl+KeyS')).toBe(2048 | 49);
  expect(toMonacoKeybinding(monaco, 'Ctrl+Comma')).toBe(2048 | 82);
});

it('combines several modifiers', () => {
  expect(toMonacoKeybinding(monaco, 'Ctrl+Shift+KeyI')).toBe(2048 | 1024 | 39);
  expect(toMonacoKeybinding(monaco, 'Ctrl+Alt+Shift+Slash')).toBe(2048 | 512 | 1024 | 90);
});

it('maps Meta onto CtrlCmd so one binding works on both platforms', () => {
  expect(toMonacoKeybinding(monaco, 'Meta+KeyS')).toBe(toMonacoKeybinding(monaco, 'Ctrl+KeyS'));
});

it('maps a function key with no modifier', () => {
  expect(toMonacoKeybinding(monaco, 'F11')).toBe(88);
});

it('returns null for anything it cannot represent', () => {
  expect(toMonacoKeybinding(monaco, '')).toBeNull();
  expect(toMonacoKeybinding(monaco, 'Ctrl+UnknownKey')).toBeNull();
  expect(toMonacoKeybinding({ KeyCode: {}, KeyMod: {} }, 'Ctrl+KeyS')).toBeNull();
  expect(toMonacoKeybinding(undefined, 'Ctrl+KeyS')).toBeNull();
});

it('keeps the preview toggle on the physical Slash key', () => {
  // 这条断言把 Ctrl+Shift+/ 修复固定住：Shift 不应影响映射出的主键。
  expect(toMonacoKeybinding(monaco, 'Ctrl+Shift+Slash')).toBe(2048 | 1024 | 90);
});
