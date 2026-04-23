import { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';

function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return raw || fallback;
}

function parseRadius(v, fallback) {
  if (!v) return fallback;
  const m = v.match(/([\d.]+)/);
  return m ? Number(m[1]) : fallback;
}

function buildTokens() {
  return {
    colorPrimary: readCssVar('--accent', '#4091ff'),
    colorInfo: readCssVar('--info', '#4091ff'),
    colorSuccess: readCssVar('--success', '#34c759'),
    colorWarning: readCssVar('--warning', '#ff9500'),
    colorError: readCssVar('--error', '#ff3b30'),
    colorText: readCssVar('--text', '#2c2c2e'),
    colorTextSecondary: readCssVar('--text-sec', '#6d6d6f'),
    colorTextTertiary: readCssVar('--text-dim', '#c4c4c6'),
    colorBgBase: readCssVar('--bg', '#f5f5f7'),
    colorBgContainer: readCssVar('--surface', '#ffffff'),
    colorBgElevated: readCssVar('--surface', '#ffffff'),
    colorBgLayout: readCssVar('--bg', '#f5f5f7'),
    colorBorder: readCssVar('--border', '#e5e5e7'),
    colorBorderSecondary: readCssVar('--border-light', '#efefef'),
    borderRadius: parseRadius(readCssVar('--radius-sm', '6px'), 6),
    borderRadiusLG: parseRadius(readCssVar('--radius', '10px'), 10),
    fontFamily:
      readCssVar('--font-app', '')
      || '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif',
    motionDurationMid: '160ms',
  };
}

export default function ThemedConfigProvider({ children }) {
  const theme = useThemeStore((s) => s.theme);
  const language = useConfigStore((s) => s.language);
  const [tokenVersion, setTokenVersion] = useState(0);

  // When theme changes, CSS variables swap — re-read them on the next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTokenVersion((v) => v + 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  const tokens = useMemo(buildTokens, [theme, tokenVersion]);

  const algorithm = theme === 'dark'
    ? antdTheme.darkAlgorithm
    : antdTheme.defaultAlgorithm;

  const locale = language === 'zh' ? zhCN : enUS;

  return (
    <ConfigProvider
      locale={locale}
      theme={{
        algorithm,
        token: tokens,
        components: {
          Modal: {
            contentBg: tokens.colorBgContainer,
            headerBg: tokens.colorBgContainer,
            titleColor: tokens.colorText,
            colorIcon: tokens.colorTextSecondary,
          },
          Tooltip: {
            colorBgSpotlight: theme === 'dark'
              ? readCssVar('--surface', '#1e1e1e')
              : '#ffffff',
            colorTextLightSolid: theme === 'dark'
              ? readCssVar('--text', '#f5f5f7')
              : readCssVar('--text', '#2c2c2e'),
          },
          Dropdown: {
            controlItemBgHover: readCssVar('--hover', '#f0f0f2'),
            controlItemBgActive: readCssVar('--accent-light', '#e8f0ff'),
          },
          Menu: {
            itemBg: 'transparent',
            subMenuItemBg: 'transparent',
            itemSelectedBg: readCssVar('--accent-light', '#e8f0ff'),
            itemHoverBg: readCssVar('--hover', '#f0f0f2'),
            itemSelectedColor: tokens.colorPrimary,
          },
          Button: {
            defaultShadow: 'none',
            primaryShadow: 'none',
            dangerShadow: 'none',
          },
          Input: {
            activeShadow: 'none',
          },
        },
      }}
    >
      <AntApp
        message={{ maxCount: 5 }}
        notification={{ placement: 'topRight', stack: { threshold: 3 } }}
      >
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
