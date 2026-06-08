/**
 * Ant Design 主题与语言配置入口。
 *
 * 本文件负责把应用自己的 CSS 变量主题系统与语言状态映射为 antd 的
 * `ConfigProvider` 配置，统一注入设计令牌、组件主题算法与本地化语言包。
 */
import { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme, App as AntApp } from 'antd';
// 入口首包中只保留英文语言包。
// 这里的大多数文案属于组件内部文本（如日期选择器、分页标签等），
// 用户在首屏阶段通常看不到，因此当 `language === 'zh'` 时再按需加载中文包。
// 这样可以减少入口包体积，并在用户保持英文界面时省掉一次额外的冷启动解析成本。
import enUS from 'antd/locale/en_US';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';

let zhCnLocale = null;
let zhCnPromise = null;

/**
 * 首次需要中文时懒加载 `zh_CN` 语言包，并缓存结果供后续复用。
 *
 * @returns {Promise<object> | null} 首次加载时返回 Promise；已缓存时返回 `null`
 */
function loadZhCn() {
  if (zhCnLocale) return null;
  if (!zhCnPromise) {
    zhCnPromise = import('antd/locale/zh_CN').then((mod) => {
      zhCnLocale = mod.default || mod;
      return zhCnLocale;
    });
  }
  return zhCnPromise;
}

/**
 * 从根元素 CSS 变量中读取设计令牌值，未命中时回退到默认值。
 *
 * @param {string} name CSS 变量名
 * @param {string} fallback 默认值
 * @returns {string} 读取到的变量值或默认值
 */
function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return raw || fallback;
}

/**
 * 把形如 `10px` 的半径值转换为 antd token 需要的数值。
 *
 * @param {string} v 原始 CSS 长度值
 * @param {number} fallback 解析失败时的回退值
 * @returns {number} 解析后的半径数值
 */
function parseRadius(v, fallback) {
  if (!v) return fallback;
  const m = v.match(/([\d.]+)/);
  return m ? Number(m[1]) : fallback;
}

/**
 * 基于当前主题 CSS 变量构建 antd 设计令牌。
 *
 * @returns {Record<string, string | number>} antd 主题 token 映射
 */
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

/**
 * 根据当前主题与语言状态，为 antd 注入设计令牌和本地化配置。
 *
 * @param {{ children: import('react').ReactNode }} props 组件属性
 * @returns {JSX.Element} 包裹全局 antd 配置的提供者组件
 */
export default function ThemedConfigProvider({ children }) {
  const theme = useThemeStore((s) => s.theme);
  const language = useConfigStore((s) => s.language);
  const [tokenVersion, setTokenVersion] = useState(0);
  const [zhLoaded, setZhLoaded] = useState(() => Boolean(zhCnLocale));

  // 主题切换后 CSS 变量会随之更新，因此下一帧重新读取一次 token。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTokenVersion((v) => v + 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  // 用户首次切到中文时再异步补齐 `zh_CN`。
  // 在语言包到达前先继续使用英文；antd 自带英文兜底，因此首帧不会出错。
  useEffect(() => {
    if (language !== 'zh' || zhCnLocale) return undefined;
    let cancelled = false;
    const promise = loadZhCn();
    if (promise) {
      promise.then(() => {
        if (!cancelled) setZhLoaded(true);
      });
    }
    return () => { cancelled = true; };
  }, [language]);

  const tokens = useMemo(buildTokens, [theme, tokenVersion]);

  const algorithm = theme === 'dark'
    ? antdTheme.darkAlgorithm
    : antdTheme.defaultAlgorithm;

  const locale = language === 'zh' && zhLoaded && zhCnLocale ? zhCnLocale : enUS;

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
