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

let editorLoad = null;
let loadedEditor = null;

/** Start at application boot, and share the result with every editor mount. */
export function preloadMonacoEditor() {
  if (!editorLoad) {
    // Importing the component does not create an editor. Load its code alongside
    // the highlighter, but expose it only after themes and tokenizers are ready.
    editorLoad = Promise.all([
      prepareMonacoRuntime(),
      import('../components/editor/MonacoEditor'),
    ]).then(([, module]) => {
      loadedEditor = module.default;
      return module;
    }).catch((error) => {
      editorLoad = null;
      throw error;
    });
  }
  return editorLoad;
}

// A resolved preload can render synchronously without React.lazy suspending for
// an extra microtask when the user opens the first file.
export function getLoadedMonacoEditor() {
  return loadedEditor;
}
