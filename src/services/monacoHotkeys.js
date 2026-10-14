/**
 * Monaco 编辑器快捷键集成。
 *
 * 为什么需要这个模块，有两件事必须在这里做：
 *
 * 1. `App.jsx` 的全局快捷键在编辑器获得焦点时不会触发。Monaco 会拦截并
 *    `preventDefault` 掉自己认识的所有按键，事件到不了 document。因此“保存”
 *    “预览切换”这类应用级动作必须在 Monaco 内再注册一次。
 * 2. 格式化、注释、命令面板这些动作由 Monaco 自己实现，用户只是换键位。这类动作
 *    通过 `addEditorAction` 追加一条动态键位规则；Monaco 给动态键位
 *    `weight1: 1000`，高于内置规则，所以用户配置能够真正覆盖默认键位。
 *
 * 每次重配都会先释放上一次注册的规则，避免旧键位残留成幽灵绑定。
 */
import { HOTKEY_ACTIONS } from '@/configs/hotkeys';
import { toMonacoKeybinding } from '@utils/monacoKeybindings';

/** 由 Monaco 官方实现、我们只负责换键位的动作。 */
const MONACO_ACTION_IDS = {
  formatDocument: 'editor.action.formatDocument',
  toggleLineComment: 'editor.action.commentLine',
  toggleBlockComment: 'editor.action.blockComment',
  commandPalette: 'editor.action.quickCommand',
};

/** 上一次注册产生的可释放对象。 */
let disposables = [];

/** 释放上一次注册的动态键位与命令。 */
function disposePrevious() {
  for (const disposable of disposables) {
    try {
      disposable?.dispose?.();
    } catch (error) {
      console.warn('[monacoHotkeys] Failed to dispose a previous keybinding:', error);
    }
  }
  disposables = [];
}

/**
 * 按当前配置注册（或重新注册）Monaco 快捷键。
 *
 * @param {object} monaco Monaco 命名空间。
 * @param {Record<string, string>} hotkeys 完整键位表（动作 id → 归一化键位）。
 * @param {object} options 注册选项。
 * @param {Record<string, Function>} [options.appHandlers] 应用级动作回调。
 * @param {Record<string, string>} [options.labels] 命令面板中的展示名。
 * @returns {() => void} 释放函数。
 */
export function configureMonacoHotkeys(monaco, hotkeys, options = {}) {
  disposePrevious();
  if (!monaco?.editor || !hotkeys) return disposePrevious;
  const { appHandlers = {}, labels = {} } = options;

  for (const action of HOTKEY_ACTIONS) {
    const keybinding = toMonacoKeybinding(monaco, hotkeys[action.id]);
    if (keybinding === null) continue;

    if (action.scope === 'editor') {
      const monacoActionId = MONACO_ACTION_IDS[action.id];
      if (!monacoActionId) continue;
      try {
        disposables.push(monaco.editor.addEditorAction({
          id: `${monacoActionId}.moki`,
          label: labels[action.id] ?? action.id,
          // 转发给内置 action，行为与官方实现保持一致（含 undo 栈处理）。
          run: (editor) => editor.getAction(monacoActionId)?.run(),
          keybindings: [keybinding],
        }));
      } catch (error) {
        console.warn(`[monacoHotkeys] Failed to register ${action.id}:`, error);
      }
      continue;
    }

    const handler = appHandlers[action.id];
    if (typeof handler !== 'function') continue;
    // `addCommand` 只注册命令本身，按键要通过 `addKeybindingRule` 绑定。
    const commandId = `moki.${action.id}`;
    try {
      const command = monaco.editor.addCommand({ id: commandId, run: handler });
      const rule = monaco.editor.addKeybindingRule({ keybinding, command: commandId });
      disposables.push({
        dispose: () => {
          rule?.dispose?.();
          command?.dispose?.();
        },
      });
    } catch (error) {
      console.warn(`[monacoHotkeys] Failed to register ${action.id}:`, error);
    }
  }
  return disposePrevious;
}

/**
 * 释放全部已注册的 Monaco 快捷键。
 */
export function disposeMonacoHotkeys() {
  disposePrevious();
}
