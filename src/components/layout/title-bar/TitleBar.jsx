import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { appWindow } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import './titlebar.scss';

function TbBtn({ title, className = 'titlebar__btn', onClick, children }) {
  return (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0.3}>
      <button className={className} onClick={onClick} type="button">
        {children}
      </button>
    </Tooltip>
  );
}

function TitleBar({ onOpenSearch, onRequestClose }) {
  const { t } = useTranslation();
  const { toggleSidebar } = useEditorStore();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <header className="titlebar">
      <TbBtn title={t('topbar.toggleSidebar')} onClick={toggleSidebar}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </TbBtn>

      <div className="titlebar__search" onClick={onOpenSearch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {t('topbar.search.placeholder')}
      </div>

      <div className="titlebar__drag" />

      <div className="titlebar__actions">
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
    </header>
  );
}

export default TitleBar;
