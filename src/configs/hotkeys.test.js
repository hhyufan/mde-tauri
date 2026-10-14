import { expect, it } from 'vitest';
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  findHotkeyConflicts,
  resolveHotkeys,
} from './hotkeys';
import { validateKeybinding } from '@utils/keybinding';

it('ships defaults that are all acceptable and conflict-free', () => {
  for (const action of HOTKEY_ACTIONS) {
    const result = validateKeybinding(action.defaultKeybinding);
    // `warning` 表示该组合可能被系统/浏览器接管（无法探测），默认值允许带警告，
    // 但不能是不可用（ok: false）。
    expect({ id: action.id, ok: result.ok }).toEqual({ id: action.id, ok: true });
  }
  expect(findHotkeyConflicts(DEFAULT_HOTKEYS).size).toBe(0);
});

it('keeps no default on a combination the system is known to reserve', () => {
  // Ctrl+Shift+I 是开发者工具的常见组合，默认值必须避开它，
  // 否则用户一打开设置就会看到一条无法消除的警告。
  for (const action of HOTKEY_ACTIONS) {
    expect({ id: action.id, warning: validateKeybinding(action.defaultKeybinding).warning })
      .toEqual({ id: action.id, warning: undefined });
  }
});

it('rejects the combos that would break normal text editing', () => {
  // 这些是硬拒绝：Ctrl+A 全选被占用后，输入框里就再也选不中文本了。
  for (const keybinding of ['Ctrl+KeyA', 'Ctrl+KeyC', 'Ctrl+KeyV', 'Ctrl+KeyX']) {
    expect(validateKeybinding(keybinding)).toEqual({ ok: false, reason: 'reserved' });
  }
});

it('keeps the preview toggle on the physical Slash key', () => {
  // Pins the fix: matching `e.key === '/'` made this unreachable on US layouts.
  expect(DEFAULT_HOTKEYS.togglePreview).toBe('Ctrl+Shift+Slash');
});

it('has a unique id per action', () => {
  const ids = HOTKEY_ACTIONS.map((action) => action.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('resolves missing entries to their default', () => {
  const resolved = resolveHotkeys(undefined);
  expect(resolved).toEqual({ ...DEFAULT_HOTKEYS });
  expect(resolveHotkeys({}).save).toBe('Ctrl+KeyS');
  expect(resolveHotkeys({ save: 'Ctrl+Shift+KeyS' }).save).toBe('Ctrl+Shift+KeyS');
});

it('treats an explicit empty string as disabled rather than missing', () => {
  const resolved = resolveHotkeys({ search: '' });
  expect(resolved.search).toBe('');
  // Other actions still receive their defaults.
  expect(resolved.save).toBe('Ctrl+KeyS');
});

it('drops unknown actions and non-string values', () => {
  const resolved = resolveHotkeys({ removedAction: 'Ctrl+KeyZ', save: 42 });
  expect(resolved.removedAction).toBeUndefined();
  expect(resolved.save).toBe('Ctrl+KeyS');
  expect(Object.keys(resolved).sort()).toEqual([...Object.keys(DEFAULT_HOTKEYS)].sort());
});

it('finds conflicts and ignores disabled bindings', () => {
  const conflicts = findHotkeyConflicts({ save: 'Ctrl+KeyS', openFile: 'Ctrl+KeyS', search: '' });
  expect(conflicts.get('Ctrl+KeyS')).toEqual(['save', 'openFile']);
  expect(conflicts.size).toBe(1);

  const withDisabled = findHotkeyConflicts({ save: '', openFile: '' });
  expect(withDisabled.size).toBe(0);
  expect(findHotkeyConflicts({})).toBeInstanceOf(Map);
  expect(findHotkeyConflicts(undefined).size).toBe(0);
});
