// 把 Monaco 命名空间挂到 window，供浏览器用例探测真实 API（`page.evaluate`
// 里无法解析裸模块名，必须在一个真正的模块里导入）。
import * as monaco from 'monaco-editor';

window.__monaco = monaco;
