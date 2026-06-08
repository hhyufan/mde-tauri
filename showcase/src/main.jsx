import React from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import ShowcaseApp from './ShowcaseApp';
import ShowcaseConfigProvider from './theme/ShowcaseConfigProvider';
import useShowcaseTheme from './theme/useShowcaseTheme';
import './styles/index.scss';
import './styles/antd-overrides.scss';
import './styles/showcase.scss';

useShowcaseTheme.getState().initTheme();

const Root = import.meta.env.DEV ? React.StrictMode : React.Fragment;

ReactDOM.createRoot(document.getElementById('root')).render(
  <Root>
    <StyleProvider hashPriority="high">
      <ShowcaseConfigProvider>
        <ShowcaseApp />
      </ShowcaseConfigProvider>
    </StyleProvider>
  </Root>
);
