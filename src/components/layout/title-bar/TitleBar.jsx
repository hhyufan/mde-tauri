import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { appWindow } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import SearchDropdown from './SearchDropdown';
import './titlebar.scss';

/**
 * 标题栏按钮封装。
 *
 * 桌面端窗口控制按钮和通用入口按钮复用同一套样式与提示行为。
 */
function TbBtn({ title, className = 'titlebar__btn', onClick, children }) {
  return (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0.3}>
      <button className={className} onClick={onClick} type="button">
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * 置顶钉子图标（与 miaogu-notepad 同款）。
 *
 * 未置顶时钉子旋转 45° 呈现“斜放”状态，置顶后回正并跟随按钮高亮，
 * 用图形本身的方向表达当前置顶状态。
 */
function PinIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fill="currentColor"
        transform="translate(0, 20)"
        d="M355.157333 42.666667h313.728c15.402667 0 29.781333 0 41.514667 1.066666 12.288 1.109333 27.605333 3.754667 41.728 13.141334a85.333333 85.333333 0 0 1 36.437333 53.76c3.413333 16.64 0.213333 31.829333-3.328 43.648-3.370667 11.306667-8.704 24.618667-14.421333 38.954666l-43.648 109.056-1.749333 4.522667-0.042667 0.085333v95.786667l0.042667 8.874667v0.128l0.085333 0.085333 5.461333 6.954667 68.181334 85.205333c13.141333 16.469333 24.832 31.061333 33.024 43.434667 7.978667 12.074667 17.706667 29.184 17.749333 49.877333a85.333333 85.333333 0 0 1-32.128 66.773333c-16.128 12.885333-35.584 16-50.005333 17.322667-14.762667 1.322667-33.450667 1.322667-54.613334 1.322667H554.666667v256a42.666667 42.666667 0 1 1-85.333334 0v-256H310.826667c-21.12 0-39.808 0-54.613334-1.322667-14.378667-1.322667-33.834667-4.437333-50.005333-17.322667a85.333333 85.333333 0 0 1-32.085333-66.773333c0-20.693333 9.770667-37.802667 17.749333-49.877333 8.192-12.373333 19.84-26.965333 33.024-43.477334L293.12 418.730667c2.986667-3.754667 4.437333-5.546667 5.461333-6.954667l0.085334-0.085333v-0.128A258.133333 258.133333 0 0 0 298.666667 402.730667v-90.88V306.773333a253.056 253.056 0 0 0-1.792-4.522666L253.866667 194.773333l-0.64-1.536c-5.717333-14.336-11.093333-27.648-14.421334-38.954666-3.541333-11.818667-6.784-27.008-3.328-43.648a85.333333 85.333333 0 0 1 36.394667-53.76c14.165333-9.386667 29.482667-12.032 41.813333-13.141334C325.333333 42.666667 339.669333 42.666667 355.114667 42.666667z m356.138667 554.666666c23.594667 0 38.357333-0.042667 48.768-0.981333l2.005333-0.213333a81.792 81.792 0 0 0-1.066666-1.706667c-5.802667-8.746667-14.933333-20.266667-29.696-38.698667l-66.986667-83.712-1.152-1.450666a118.528 118.528 0 0 1-13.824-20.053334 85.205333 85.205333 0 0 1-7.594667-21.674666a118.314667 118.314667 0 0 1-1.706666-24.277334V311.850667v-1.066667c0-3.84 0-8.661333 0.512-13.653333 0.512-4.266667 1.322667-8.533333 2.474666-12.714667 1.28-4.778667 3.114667-9.301333 4.565334-12.842667l0.341333-0.938666 43.008-107.52a455.424 455.424 0 0 0 12.8-34.304l-1.066667-0.085334A455.552 455.552 0 0 0 667.178667 128H356.864a455.552 455.552 0 0 0-36.608 0.853333l0.298667 1.024c2.133333 7.125333 5.973333 16.810667 12.544 33.237334l42.965333 107.52 0.426667 0.938666a85.333333 85.333333 0 0 1 7.552 39.253334v93.738666c0 6.912 0 15.616-1.749334 24.32a85.290667 85.290667 0 0 1-7.637333 21.632 118.528 118.528 0 0 1-14.933333 21.504l-66.986667 83.712c-14.72 18.432-23.893333 29.952-29.696 38.698667a85.333333 85.333333 0 0 0-1.109333 1.706667l2.048 0.213333c10.410667 0.938667 25.173333 0.981333 48.725333 0.981333h398.592z"
      />
    </svg>
  );
}

/**
 * 顶部标题栏。
 *
 * 负责侧边栏开关、搜索入口，以及桌面端的最小化/最大化/关闭窗口控制。
 * 在移动端与 Android 上则退化成更轻量的导航头。
 */
function TitleBar({ searchOpen, onOpenSearch, onCloseSearch, onRequestClose }) {
  const { t } = useTranslation();
  const toggleSidebar = useEditorStore((state) => state.toggleSidebar);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const { isMobileLayout, isAndroid } = useResponsiveLayout();
  const isDesktopWindow = !isMobileLayout && !isAndroid;

  useEffect(() => {
    // 最大化状态只能从原生窗口层读取；监听 resize 可兼容双击标题栏、
    // 系统快捷键和窗口控制按钮等多种切换入口。
    if (!isDesktopWindow) return undefined;
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [isDesktopWindow]);

  useEffect(() => {
    // 置顶状态同样以原生窗口为准；非桌面环境（网页预览等）读取不到时保持未置顶。
    if (!isDesktopWindow) return undefined;
    appWindow
      .isAlwaysOnTop()
      .then((value) => setIsPinned(Boolean(value)))
      .catch(() => setIsPinned(false));
  }, [isDesktopWindow]);

  /**
   * 切换窗口置顶/取消置顶。
   *
   * @returns {void}
   */
  const togglePin = () => {
    const next = !isPinned;
    // 权限被拒绝等异常只回滚视觉状态，不让未处理的 Promise 拒绝冒泡到全局。
    appWindow
      .setAlwaysOnTop(next)
      .then(() => setIsPinned(next))
      .catch(() => setIsPinned(false));
  };

  return (
    <header className={`titlebar ${!isDesktopWindow ? 'titlebar--mobile' : ''}`}>
      <TbBtn title={t('topbar.toggleSidebar')} onClick={toggleSidebar}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </TbBtn>

      <SearchDropdown open={searchOpen} onOpen={onOpenSearch} onClose={onCloseSearch} />

      <div className="titlebar__drag" />

      {isDesktopWindow && (
        <div className="titlebar__actions">
          <TbBtn
            title={isPinned ? t('topbar.unpin') : t('topbar.pin')}
            className={`titlebar__btn titlebar__btn--pin${isPinned ? ' is-pinned' : ''}`}
            onClick={togglePin}
          >
            <PinIcon className={`titlebar__pin-icon${isPinned ? '' : ' titlebar__pin-icon--unpinned'}`} />
          </TbBtn>
          <TbBtn title={t('topbar.minimize')} onClick={() => appWindow.minimize()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </TbBtn>
          <TbBtn
            title={isMaximized ? t('topbar.unmaximize') : t('topbar.maximize')}
            onClick={() => (isMaximized ? appWindow.unmaximize() : appWindow.maximize())}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </TbBtn>
          <TbBtn
            title={t('topbar.close')}
            className="titlebar__btn titlebar__btn--close"
            onClick={onRequestClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </TbBtn>
        </div>
      )}
    </header>
  );
}

export default TitleBar;
