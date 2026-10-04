/**
 * ?????????
 *
 * ?????????????????????? Ant Design ??????
 */
// 说明：Monaco 的语言与主题注册不在应用首屏执行。
// 整套 `monaco-editor-nls-adapter` 本地化方案已下线（它需要在构建期重写 Monaco
// 源码，并保证 zh-hans 字典先于编辑器求值），现在 Monaco 使用内置英文界面。
// 剩余的运行时准备（mgtree 语言 + 两套主题）仍在编辑器挂载前的同一条懒加载
// 链里完成，详见 `src/components/editor/LazyMonacoEditor.jsx` 与
// `src/utils/monacoRuntimeBoot.js`。

import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import './i18n';
import '@styles/index.scss';
import '@styles/prism-theme.scss';
import '@styles/antd-overrides.scss';

// StrictMode 在开发态很有价值：它会通过额外执行一次 effect 来暴露副作用问题。
// 但在生产环境中这属于纯额外开销，首屏渲染阶段会多触发一轮相关逻辑。
// 因此这里保留开发期保护，同时避免线上多余成本。
const Root = import.meta.env.DEV ? React.StrictMode : React.Fragment;
const App = lazy(() => import('./App'));

ReactDOM.createRoot(document.getElementById('root')).render(
  <Root>
    <StyleProvider hashPriority="high">
      <ThemedConfigProvider>
        <Suspense fallback={<div className="app-boot-placeholder" aria-label="Loading" />}>
          <App />
        </Suspense>
      </ThemedConfigProvider>
    </StyleProvider>
  </Root>
);
