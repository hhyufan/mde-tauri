/**
 * 快捷键键位工具。
 *
 * 键位以「归一化字符串」保存，形如 `Ctrl+Shift+Slash`、`F11`、`Escape`：
 *
 * - 使用 `KeyboardEvent.code`（物理按键）而不是 `key`（输入结果）。这是为了修掉
 *   一个真实缺陷：`Ctrl+Shift+/` 在 US 布局下 `key` 是 `'?'` 而不是 `'/'`，
 *   在德语等布局下更是完全不同的字符，用 `key` 判断会导致快捷键永远按不出来。
 *   `code` 与布局、是否按住 Shift 无关，`Slash` 就是那个键。
 * - 修饰键顺序固定为 Ctrl、Alt、Shift、Meta，便于比较与去重。
 * - 统一存 `Ctrl`，由展示层决定是否渲染成 macOS 的 `⌘`。这样同一份配置在
 *   跨平台同步时不需要改写（macOS 的 Ctrl 是另一颗键，不能直接等同）。
 */

/** 修饰键在归一化字符串中的固定顺序。 */
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

/** `KeyboardEvent.code` 中属于纯修饰键、不能单独成键的值。 */
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu',
]);

/** 不允许被用户占用的组合：一旦占用会让输入框无法复制粘贴。 */
const RESERVED_KEYBINDINGS = new Set(['Ctrl+KeyC', 'Ctrl+KeyV', 'Ctrl+KeyX', 'Ctrl+KeyA']);

/**
 * 已知由浏览器 / WebView / 操作系统接管的组合。
 *
 * 这类键位**无法通过任何前端接口探测**：操作系统和 WebView 的热键注册表对页面
 * 不可见。因此这里既不能把它们当成“一定可用”而放行（用户会以为绑定成功却按不动），
 * 也不能当成“一定被占用”而拒绝（有些平台/环境下它们其实能到达页面）。
 *
 * 处理方式是如实告知“可能被系统占用”，保存与否交给用户决定并在提示里说明。
 * 各平台还允许用户自行改系统热键，任何硬编码清单都必然不完整——这正是这里只做
 * 提示、不做拦截的原因。
 */
const SYSTEM_RESERVED_KEYBINDINGS = new Map([
  // 浏览器窗口级
  ['Ctrl+KeyW', 'browserWindow'],
  ['Ctrl+Shift+KeyW', 'browserWindow'],
  ['Ctrl+KeyT', 'browserTab'],
  ['Ctrl+Shift+KeyT', 'browserTab'],
  ['Ctrl+KeyN', 'browserWindow'],
  ['Ctrl+Shift+KeyN', 'browserWindow'],
  ['Ctrl+KeyR', 'browserReload'],
  ['F5', 'browserReload'],
  // WebView / 开发者工具
  ['F12', 'browserDevtools'],
  ['Ctrl+Shift+KeyI', 'browserDevtools'],
  ['Ctrl+Shift+KeyJ', 'browserDevtools'],
  ['Ctrl+Shift+KeyC', 'browserDevtools'],
  // 系统级
  ['Alt+F4', 'systemQuit'],
  ['Meta+KeyQ', 'systemQuit'],
  ['Meta+Tab', 'systemSwitch'],
  ['Alt+Tab', 'systemSwitch'],
  ['Ctrl+Alt+Delete', 'system'],
  ['Meta+KeyL', 'systemLock'],
]);

/**
 * 查询某个键位是否已知会被系统 / 浏览器接管。
 *
 * 只在 `validateKeybinding` 内部使用：调用方拿到的应当是 `warning` 原因码，
 * 而不是这张必然不完整的清单本身。
 *
 * @param {string} keybinding 归一化键位。
 * @returns {string|undefined} 接管来源标识；未知时返回 undefined。
 */
function systemReservationOf(keybinding) {
  return SYSTEM_RESERVED_KEYBINDINGS.get(keybinding);
}

/**
 * 判断某个物理按键是否只能作为修饰键使用。
 *
 * @param {string} code `KeyboardEvent.code`。
 * @returns {boolean} 是纯修饰键时为 true。
 */
export function isModifierCode(code) {
  return MODIFIER_CODES.has(code);
}

/**
 * 把一次键盘事件转换成归一化键位字符串。
 *
 * @param {KeyboardEvent} event 键盘事件。
 * @returns {string} 归一化键位；只按了修饰键或无法识别时返回空串。
 */
export function keybindingFromEvent(event) {
  if (!event || !event.code) return '';
  if (isModifierCode(event.code)) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(event.code);
  return parts.join('+');
}

/**
 * 判断一次键盘事件是否命中某个键位。
 *
 * @param {KeyboardEvent} event 键盘事件。
 * @param {string} keybinding 归一化键位。
 * @returns {boolean} 命中时为 true。
 */
export function matchesKeybinding(event, keybinding) {
  if (!keybinding) return false;
  return keybindingFromEvent(event) === keybinding;
}

/**
 * 把归一化键位切成修饰键与主键两部分。
 *
 * @param {string} keybinding 归一化键位。
 * @returns {{modifiers: string[], code: string}} 解析结果。
 */
export function parseKeybinding(keybinding) {
  if (typeof keybinding !== 'string' || keybinding === '') return { modifiers: [], code: '' };
  const parts = keybinding.split('+');
  const code = parts.pop() ?? '';
  return {
    modifiers: MODIFIER_ORDER.filter((name) => parts.includes(name)),
    code,
  };
}

/**
 * 判断键位是否包含 Ctrl（或平台上的等效键）。
 *
 * 用于过滤掉“字母键单独成快捷键”这类会吞掉正常输入的配置。
 *
 * @param {string} keybinding 归一化键位。
 * @returns {boolean} 含 Ctrl 或 Meta 时为 true。
 */
export function hasModifier(keybinding) {
  const { modifiers } = parseKeybinding(keybinding);
  return modifiers.includes('Ctrl') || modifiers.includes('Meta');
}

/**
 * 校验一个键位是否可以绑定。
 *
 * @param {string} keybinding 归一化键位。
 * @returns {{ok: boolean, reason?: string, warning?: string}} 校验结果。
 *   `reason` 为拒绝原因码；`warning` 为“可以保存但需提醒”的原因码。
 */
export function validateKeybinding(keybinding) {
  if (typeof keybinding !== 'string' || keybinding === '') {
    return { ok: false, reason: 'empty' };
  }
  const { code } = parseKeybinding(keybinding);
  if (!code) return { ok: false, reason: 'empty' };
  if (isModifierCode(code)) return { ok: false, reason: 'modifierOnly' };
  if (RESERVED_KEYBINDINGS.has(keybinding)) return { ok: false, reason: 'reserved' };
  // 没有修饰键时只允许功能键区，否则会抢走普通打字。
  if (!hasModifier(keybinding) && !/^F\d{1,2}$/.test(code)) {
    return { ok: false, reason: 'needsModifier' };
  }
  // 系统 / 浏览器可能抢先处理：允许保存，但必须如实提示而不是假装没问题。
  const reservation = systemReservationOf(keybinding);
  return reservation ? { ok: true, warning: reservation } : { ok: true };
}

/** 展示名覆盖表：`KeyboardEvent.code` 对人类并不总是可读。 */
const CODE_LABELS = {
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/**
 * 把 `KeyboardEvent.code` 转成可读标签。
 *
 * @param {string} code 物理按键值。
 * @returns {string} 展示用标签。
 */
export function codeToLabel(code) {
  if (!code) return '';
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

/**
 * 把归一化键位渲染成展示文本。
 *
 * @param {string} keybinding 归一化键位。
 * @param {boolean} [isMac] 是否按 macOS 习惯显示（Ctrl → ⌘，Alt → ⌥，Shift → ⇧）。
 * @returns {string} 形如 `Ctrl+Shift+/` 或 `⌘⇧/` 的展示文本。
 */
export function formatKeybinding(keybinding, isMac = false) {
  const { modifiers, code } = parseKeybinding(keybinding);
  if (!code) return '';
  const label = codeToLabel(code);
  if (!isMac) return [...modifiers, label].join('+');
  const symbols = { Ctrl: '⌘', Meta: '⌘', Alt: '⌥', Shift: '⇧' };
  return modifiers.map((name) => symbols[name] ?? name).join('') + label;
}
