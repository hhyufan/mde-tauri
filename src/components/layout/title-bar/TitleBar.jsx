import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { appWindow } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import './titlebar.scss';

function TitleBar({ onOpenSearch }) {
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
      <button
        className="titlebar__btn"
        onClick={toggleSidebar}
        title={t('topbar.toggleSidebar')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>

      <div className="titlebar__search" onClick={onOpenSearch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {t('topbar.search.placeholder')}
      </div>

      <div className="titlebar__drag" />

      <div className="titlebar__actions">
        <button className="titlebar__btn" onClick={() => appWindow.minimize()} title={t('topbar.minimize')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          className="titlebar__btn"
          onClick={() => (isMaximized ? appWindow.unmaximize() : appWindow.maximize())}
          title={isMaximized ? t('topbar.unmaximize') : t('topbar.maximize')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </button>
        <button className="titlebar__btn titlebar__btn--close" onClick={() => appWindow.close()} title={t('topbar.close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export default TitleBar;
