import React from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import App from './App';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import './i18n';
import '@styles/index.scss';
import '@styles/antd-overrides.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StyleProvider hashPriority="high">
      <ThemedConfigProvider>
        <App />
      </ThemedConfigProvider>
    </StyleProvider>
  </React.StrictMode>
);
