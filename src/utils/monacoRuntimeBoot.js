/**
 * Prepare every Monaco runtime dependency before an editor instance exists.
 *
 * Production chunks are evaluated in a different order from Vite dev modules.
 * Keeping language registration and theme definition behind one promise
 * guarantees that an editor is never created — and never painted — before
 * syntax highlighting is available.
 */
/**
 * 返回 Monaco 运行时（语言 + 主题）准备完成的 Promise。
 *
 * 初始化任务由 Monaco 实例保存，热更新不会遗留模块级旧 Promise。
 *
 * @returns {Promise<void>} 准备完成后的 Promise。
 */
export function prepareMonacoRuntime() {
  // Keep this import dynamic so Monaco stays outside the entry chunk.
  return import('./monacoShiki').then(({ initMonacoShiki }) => initMonacoShiki());
}
