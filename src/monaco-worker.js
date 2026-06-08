/**
 * Monaco Worker ???????
 *
 * ?????????? Worker ????????????????????????????
 */
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
// 语言环境会在更早阶段于 src/utils/monacoLocaleBoot.js 中完成初始化
// （它会在 main.jsx 里最先被导入），以确保设置发生在 monaco-editor
// 模块代码执行之前。这里不再调用 initMonacoLocale()，因为在当前时机
// 下，MonacoEditor.jsx 已经导入过 monaco-editor。

self.MonacoEnvironment = {
  /**
   * ?????????? Worker ???
   */
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};
