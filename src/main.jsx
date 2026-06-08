/**
 * ?????????
 *
 * ?????????????????????? Ant Design ??????
 */
// 说明：这里不再直接导入 `monacoLocaleBoot`。
// 它之前位于本文件顶部，是因为 Monaco 会在模块加载时捕获 NLS 文案，
// 所以必须在 `monaco-editor` 首次加载前就把语言环境设好。
// 现在这段启动逻辑已经挪到 `LazyMonacoEditor` 的动态导入链中：
// Monaco 仍会在真正执行前拿到正确语言，但 NLS 适配层和 zh-hans 字典
// 不再进入应用首屏启动成本。详见 `src/components/editor/LazyMonacoEditor.jsx`。

import React from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import App from './App';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import './i18n';
import '@styles/index.scss';
import '@styles/antd-overrides.scss';

// StrictMode 在开发态很有价值：它会通过额外执行一次 effect 来暴露副作用问题。
// 但在生产环境中这属于纯额外开销，首屏渲染阶段会多触发一轮相关逻辑。
// 因此这里保留开发期保护，同时避免线上多余成本。
const Root = import.meta.env.DEV ? React.StrictMode : React.Fragment;

ReactDOM.createRoot(document.getElementById('root')).render(
  <Root>
    <StyleProvider hashPriority="high">
      <ThemedConfigProvider>
        <App />
      </ThemedConfigProvider>
    </StyleProvider>
  </Root>
);
