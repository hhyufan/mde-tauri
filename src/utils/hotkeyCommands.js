/**
 * 应用级快捷键动作映射。
 *
 * 这些动作既可能在焦点位于编辑器外时触发（`App.jsx` 的全局 keydown），也可能在
 * Monaco 获得焦点时触发（Monaco 会吞掉按键，全局监听收不到事件）。为了避免两处
 * 各写一遍、日久产生行为差异，这里集中生成回调：
 *
 * - 能直接从 store 取到状态的动作（侧边栏、预览切换）直接调用 store。
 * - 需要 React 局部状态或文件管理器能力的动作（搜索、设置、保存、打开文件）通过
 *   `HOTKEY_COMMAND_EVENT` 事件上报给 `App.jsx`，由它统一执行。
 */

/** 需要 App 层执行的动作通过该事件上报。 */
export const HOTKEY_COMMAND_EVENT = 'moki:hotkey-command';

/**
 * 触发一个应用级快捷键动作。
 *
 * @param {string} actionId 动作标识。
 */
export function dispatchHotkeyCommand(actionId) {
  window.dispatchEvent(new CustomEvent(HOTKEY_COMMAND_EVENT, { detail: { actionId } }));
}

/**
 * 生成应用级快捷键的回调表，供 Monaco 注册使用。
 *
 * @param {object} deps 依赖注入。
 * @param {() => void} deps.toggleSidebar 切换侧边栏。
 * @param {() => void} deps.togglePreview 切换编辑/预览视图。
 * @returns {Record<string, () => void>} 动作标识到回调的映射。
 */
export function createAppHotkeyHandlers({ toggleSidebar, togglePreview }) {
  return {
    save: () => dispatchHotkeyCommand('save'),
    openFile: () => dispatchHotkeyCommand('openFile'),
    search: () => dispatchHotkeyCommand('search'),
    openSettings: () => dispatchHotkeyCommand('openSettings'),
    toggleSidebar,
    togglePreview,
    toggleFullscreen: () => dispatchHotkeyCommand('toggleFullscreen'),
  };
}
