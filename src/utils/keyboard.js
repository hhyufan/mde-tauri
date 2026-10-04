/**
 * 键盘事件工具。
 *
 * 中文、日文、韩文输入法在候选词上屏期间会先派发 `keydown`：此时 Chromium 把
 * `keyCode` 报成 229、`isComposing` 为 true，而 `key` 既可能是 `Process`，也可能
 * 是真实的 `Enter`、`ArrowUp`、`ArrowDown`。
 *
 * 如果业务代码在这些事件上执行「回车提交」「方向键切换选中项」之类的动作，甚至
 * 调用 `preventDefault()`，就会把候选词的选择和上屏抢走，用户看到的现象是输入法
 * 完全无法使用。因此任何自行处理 Enter / 方向键的输入框，都必须先经过这个判断。
 */

/**
 * 判断一次键盘事件是否发生在输入法组合过程中。
 *
 * 同时支持原生事件与 React 合成事件。
 *
 * @param {KeyboardEvent|import('react').KeyboardEvent} event 键盘事件对象。
 * @returns {boolean} 处于输入法组合中时为 true，调用方应立即跳过快捷动作。
 */
export function isImeComposing(event) {
  if (!event) return false;
  const native = event.nativeEvent ?? event;
  return Boolean(native.isComposing) || native.keyCode === 229;
}
