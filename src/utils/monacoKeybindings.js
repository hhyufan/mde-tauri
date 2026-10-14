/**
 * 把归一化键位转换成 Monaco 需要的按键掩码。
 *
 * Monaco 的 `IKeybindingRule.keybinding` 是一个数字：低 16 位是 `KeyCode`，
 * 高位是 `KeyMod` 修饰键标志。注册动态键位时 Monaco 会给它们 `weight1: 1000`，
 * 高于内置键位，因此这里的映射就是「用户配置覆盖内置默认」的依据。
 *
 * 转换函数依赖传入的 `monaco` 命名空间，而不是直接 import，这样既复用了 Monaco
 * 自己的 `KeyCode`/`KeyMod` 枚举（不会因为枚举值变化而错位），也便于单元测试。
 */
import { parseKeybinding } from '@utils/keybinding';

/**
 * 把归一化键位转换为 Monaco 键位掩码。
 *
 * @param {object} monaco Monaco 命名空间（需要 `KeyCode` 与 `KeyMod`）。
 * @param {string} keybinding 归一化键位，例如 `Ctrl+Shift+Slash`。
 * @returns {number|null} Monaco 键位掩码；无法识别时返回 null。
 */
export function toMonacoKeybinding(monaco, keybinding) {
  const { modifiers, code } = parseKeybinding(keybinding);
  if (!code) return null;
  const keyCode = monaco?.KeyCode?.[code];
  if (typeof keyCode !== 'number') return null;
  let mask = 0;
  if (modifiers.includes('Ctrl')) mask |= monaco.KeyMod.CtrlCmd;
  if (modifiers.includes('Meta')) mask |= monaco.KeyMod.CtrlCmd;
  if (modifiers.includes('Alt')) mask |= monaco.KeyMod.Alt;
  if (modifiers.includes('Shift')) mask |= monaco.KeyMod.Shift;
  return mask | keyCode;
}
