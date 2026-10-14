/**
 * 快捷键注册表。
 *
 * 这是「有哪些可配置快捷键」的唯一事实来源：默认键位、分组、作用域都在这里定义，
 * 设置界面、快捷键匹配、Monaco 键位同步都从这份表读取。
 *
 * `scope` 的含义：
 * - `app`：应用级动作，由 `App.jsx` 在 document 上统一匹配并执行。
 * - `editor`：Monaco 编辑器动作，通过编辑器的 addCommand 注册。
 */

/** @typedef {'app'|'editor'} HotkeyScope */

/**
 * @typedef {object} HotkeyAction
 * @property {string} id 稳定标识，用于持久化，不可随意改名。
 * @property {HotkeyScope} scope 作用域。
 * @property {string} group 设置界面的分组标签键。
 * @property {string} label 动作名称的国际化键。
 * @property {string} defaultKeybinding 默认键位（归一化字符串）。
 * @property {boolean} [essential] 为 true 时允许清空绑定而不提示风险。
 */

/** @type {HotkeyAction[]} */
export const HOTKEY_ACTIONS = [
  {
    id: 'save',
    scope: 'app',
    group: 'file',
    label: 'settings.shortcuts.action.save',
    defaultKeybinding: 'Ctrl+KeyS',
  },
  {
    id: 'openFile',
    scope: 'app',
    group: 'file',
    label: 'settings.shortcuts.action.openFile',
    defaultKeybinding: 'Ctrl+KeyO',
  },
  {
    id: 'search',
    scope: 'app',
    group: 'navigation',
    label: 'settings.shortcuts.action.search',
    defaultKeybinding: 'Ctrl+KeyP',
  },
  {
    id: 'toggleSidebar',
    scope: 'app',
    group: 'navigation',
    label: 'settings.shortcuts.action.toggleSidebar',
    defaultKeybinding: 'Ctrl+KeyB',
  },
  {
    id: 'togglePreview',
    scope: 'app',
    group: 'navigation',
    label: 'settings.shortcuts.action.togglePreview',
    // 修复前这里是 `Ctrl+Shift+/` 却比较 `e.key === '/'`，在 US 布局下
    // Shift+/ 得到的 key 是 '?'，因此这个快捷键一直按不出来。
    defaultKeybinding: 'Ctrl+Shift+Slash',
  },
  {
    id: 'openSettings',
    scope: 'app',
    group: 'navigation',
    label: 'settings.shortcuts.action.openSettings',
    defaultKeybinding: 'Ctrl+Comma',
  },
  {
    id: 'toggleFullscreen',
    scope: 'app',
    group: 'window',
    label: 'settings.shortcuts.action.toggleFullscreen',
    defaultKeybinding: 'F11',
  },
  {
    id: 'formatDocument',
    scope: 'editor',
    group: 'editor',
    label: 'settings.shortcuts.action.formatDocument',
    // 刻意避开 Ctrl+Shift+I：那个组合被浏览器/WebView 的开发者工具占用，
    // 用它会让默认配置常年顶着一条“可能被系统抢先处理”的警告。
    defaultKeybinding: 'Ctrl+Shift+KeyF',
  },
  {
    id: 'toggleLineComment',
    scope: 'editor',
    group: 'editor',
    label: 'settings.shortcuts.action.toggleLineComment',
    defaultKeybinding: 'Ctrl+Slash',
  },
  {
    id: 'toggleBlockComment',
    scope: 'editor',
    group: 'editor',
    label: 'settings.shortcuts.action.toggleBlockComment',
    defaultKeybinding: 'Ctrl+Shift+KeyA',
  },
  {
    id: 'commandPalette',
    scope: 'editor',
    group: 'editor',
    label: 'settings.shortcuts.action.commandPalette',
    defaultKeybinding: 'F1',
  },
];

/** 按 id 索引的动作表。 */
export const HOTKEY_ACTION_MAP = new Map(HOTKEY_ACTIONS.map((action) => [action.id, action]));

/** 默认键位表：`actionId -> keybinding`。 */
export const DEFAULT_HOTKEYS = Object.freeze(
  Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action.id, action.defaultKeybinding])),
);

/** 设置界面中分组的展示顺序。 */
export const HOTKEY_GROUP_ORDER = ['file', 'navigation', 'window', 'editor'];

/**
 * 合并用户配置与默认值，补齐缺失或无效的条目。
 *
 * 这样即使旧版本配置里没有新动作，或有动作被移除，界面与匹配逻辑拿到的都是一份
 * 完整的键位表；用户主动清空（空串）会被保留，不会被默认值覆盖。
 *
 * @param {object} [userHotkeys] 持久化的用户键位。
 * @returns {Record<string, string>} 完整键位表。
 */
export function resolveHotkeys(userHotkeys) {
  const source = userHotkeys && typeof userHotkeys === 'object' ? userHotkeys : {};
  const resolved = {};
  for (const action of HOTKEY_ACTIONS) {
    const value = source[action.id];
    // 只接受字符串：`undefined` 表示“用户没设置过”，回落到默认值。
    resolved[action.id] = typeof value === 'string' ? value : action.defaultKeybinding;
  }
  return resolved;
}

/**
 * 找出所有重复绑定。
 *
 * 空键位表示“已禁用”，不参与冲突判断。
 *
 * @param {Record<string, string>} hotkeys 完整键位表。
 * @returns {Map<string, string[]>} `keybinding -> actionId[]`，仅包含冲突项。
 */
export function findHotkeyConflicts(hotkeys) {
  const byKeybinding = new Map();
  for (const [actionId, keybinding] of Object.entries(hotkeys ?? {})) {
    if (!keybinding) continue;
    const list = byKeybinding.get(keybinding) ?? [];
    list.push(actionId);
    byKeybinding.set(keybinding, list);
  }
  return new Map([...byKeybinding].filter(([, ids]) => ids.length > 1));
}

/**
 * 记录「正在录入快捷键」的嵌套层级。
 *
 * 录入期间必须挂起全局快捷键：用户为了改绑 Ctrl+S 而按下 Ctrl+S 时，不应真的
 * 触发一次保存；按 Escape 想取消录入时，也不应顺手把设置弹窗关掉。
 *
 * 用计数器而不是布尔量，是为了兼容动画/过渡期间同时挂载多个设置面板的情况。
 */
let shortcutCaptureDepth = 0;

/**
 * 判断当前是否正在录入快捷键。
 *
 * @returns {boolean} 录入中时为 true。
 */
export function isCapturingShortcut() {
  return shortcutCaptureDepth > 0;
}

/**
 * 进入快捷键录入状态，返回退出该状态的函数（可安全重复调用）。
 *
 * @returns {() => void} 退出录入状态的函数。
 */
export function beginShortcutCapture() {
  shortcutCaptureDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    shortcutCaptureDepth = Math.max(0, shortcutCaptureDepth - 1);
  };
}
