import { useEffect, useMemo, useState } from 'react';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import useShowcaseTheme from './useShowcaseTheme';

function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function parseRadius(value, fallback) {
  const matched = String(value || '').match(/([\d.]+)/);
  return matched ? Number(matched[1]) : fallback;
}

function buildTokens() {
  return {
    colorPrimary: readCssVar('--accent', '#2f6bff'),
    colorInfo: readCssVar('--info', '#2f6bff'),
    colorSuccess: readCssVar('--success', '#38b26d'),
    colorWarning: readCssVar('--warning', '#f7a531'),
    colorError: readCssVar('--error', '#ef5350'),
    colorText: readCssVar('--text', '#1f2430'),
    colorTextSecondary: readCssVar('--text-sec', '#62697a'),
    colorTextTertiary: readCssVar('--text-dim', '#8c91a1'),
    colorBgBase: readCssVar('--bg', '#f3f5fb'),
    colorBgLayout: readCssVar('--bg', '#f3f5fb'),
    colorBgContainer: readCssVar('--surface', '#ffffff'),
    colorBgElevated: readCssVar('--surface', '#ffffff'),
    colorBorder: readCssVar('--border', '#d9deea'),
    colorBorderSecondary: readCssVar('--border-light', '#e8ebf4'),
    borderRadius: parseRadius(readCssVar('--radius-sm', '8px'), 8),
    borderRadiusLG: parseRadius(readCssVar('--radius', '18px'), 18),
    fontFamily: readCssVar(
      '--font-app',
      '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    ),
    motionDurationMid: '180ms',
  };
}

export default function ShowcaseConfigProvider({ children }) {
  const theme = useShowcaseTheme((state) => state.theme);
  const [tokenVersion, setTokenVersion] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTokenVersion((current) => current + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [theme]);

  const tokens = useMemo(buildTokens, [theme, tokenVersion]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: tokens,
        components: {
          Card: {
            headerBg: 'transparent',
          },
          Button: {
            defaultShadow: 'none',
            primaryShadow: 'none',
          },
          Input: {
            activeShadow: 'none',
          },
          Modal: {
            contentBg: tokens.colorBgContainer,
            headerBg: tokens.colorBgContainer,
            titleColor: tokens.colorText,
          },
          Tree: {
            nodeHoverBg: readCssVar('--hover', '#eef2fb'),
            nodeSelectedBg: readCssVar('--accent-light', '#e5edff'),
          },
        },
      }}
    >
      <AntdApp message={{ maxCount: 4 }} notification={{ placement: 'topRight' }}>
        {children}
      </AntdApp>
    </ConfigProvider>
  );
}
