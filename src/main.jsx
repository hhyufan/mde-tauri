// NOTE: monacoLocaleBoot is intentionally NOT imported here anymore. It used
// to live at the top of this file because Monaco captures NLS strings at
// module-load time, so the locale had to be set before `monaco-editor` first
// loaded. We've now moved that boot import into LazyMonacoEditor's dynamic
// import chain � Monaco still gets the locale before its first byte runs, but
// neither the NLS adapter nor the zh-hans dictionary cost anything at app
// startup. See src/components/editor/LazyMonacoEditor.jsx.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import App from './App';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import './i18n';
import '@styles/index.scss';
import '@styles/antd-overrides.scss';

// StrictMode is invaluable in development (double-invokes effects to surface
// side-effect bugs), but in production it's pure overhead � twice as many
// effect runs on the very first render. Keep the dev safety net, drop the
// release cost.
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
