/**
 * ?????????
 *
 * ?????????????????????? Ant Design ??????
 */
// 应用启动时即预热 Monaco，组件代码与高亮并行加载。
// 语言和主题准备完成后才创建编辑器实例；启动画面交棒独立处理。

// 必须放在最前面：品牌更名（MDE → MokiDown）的一次性本地存储迁移要在任何
// persist store 创建并回填之前执行，否则首启会先读到空的新键。
import '@utils/storageMigration';
import React, { lazy, Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import { preloadMonacoEditor } from '@utils/monacoRuntimeBoot';
import { announceMainWindowReady } from '@utils/startupHandover';
import { installTooltipHygiene } from '@utils/tooltipHygiene';
import './i18n';
import '@styles/index.scss';
import '@styles/prism-theme.scss';
import '@styles/antd-overrides.scss';

void preloadMonacoEditor().catch((error) => console.error('[Monaco] Startup preload failed:', error));

// 提示清理：触发元素被拖走、或浮层盖上来时，antd 收不到 mouseleave，提示会赖着不走。
// 这里在滚动/按下/失焦等时刻统一收掉它们。详见 utils/tooltipHygiene.js。
installTooltipHygiene();

// StrictMode 在开发态很有价值：它会通过额外执行一次 effect 来暴露副作用问题。
// 但在生产环境中这属于纯额外开销，首屏渲染阶段会多触发一轮相关逻辑。
// 因此这里保留开发期保护，同时避免线上多余成本。
const Root = import.meta.env.DEV ? React.StrictMode : React.Fragment;
const App = lazy(() => import('./App'));

function SplashHandover({ children }) {
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    return announceMainWindowReady(Promise.all([
      preloadMonacoEditor(),
      import('@/services/editorSession').then(({ restoreEditorSession }) => restoreEditorSession()),
    ]));
  }, []);
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <Root>
    <StyleProvider hashPriority="high">
      <ThemedConfigProvider>
        <Suspense fallback={null}>
          <SplashHandover>
            <App />
          </SplashHandover>
        </Suspense>
      </ThemedConfigProvider>
    </StyleProvider>
  </Root>
);
