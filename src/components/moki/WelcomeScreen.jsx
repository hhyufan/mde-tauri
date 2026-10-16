import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import {
  FileAddOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import useFileStore, { getScopedRecentFiles } from '@store/useFileStore';
import useAuthStore from '@store/useAuthStore';
import { GUEST_USER_SCOPE } from '@store/userScope';
import { useFileManager } from '@hooks/useFileManager';
import MokiSprite from './MokiSprite';
import MokiAmbient from './MokiAmbient';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const display = useConfigStore((state) => state.mokiDisplay);
  const recentEntries = useFileStore((state) => state.recentFiles);
  const userId = useAuthStore((state) => state.user?.id || GUEST_USER_SCOPE);
  const { openFileDialog, openFolderDialog, openFileFromPath } = useFileManager();
  const recent = useMemo(
    () => getScopedRecentFiles(recentEntries, userId).slice(0, 4),
    [recentEntries, userId],
  );
  return (
    <section
      className={`moki-welcome ${display === 'hidden' ? 'moki-welcome--plain' : ''}`}
      aria-label={t('moki.welcomeLabel')}
    >
      <div className="moki-welcome__content">
        <span className="moki-eyebrow">MokiDown / YOUR IDEAS, AT HOME</span>
        <h1>{t('moki.welcomeTitle')}</h1>
        <h2 className="moki-welcome__task-heading">{t('moki.startTask')}</h2>
        <div className="moki-welcome__actions">
          <button
            type="button"
            className="moki-action moki-action--primary"
            onClick={() => useEditorStore.getState().createUntitledTab()}
          >
            <FileAddOutlined />
            <span className="moki-action__copy">
              <strong>{t('moki.newDocument')}</strong>
              <small>{t('moki.newDocumentDesc')}</small>
            </span>
            <ArrowRightOutlined />
          </button>
          <button type="button" className="moki-action" onClick={openFileDialog}>
            <FileTextOutlined />
            <span className="moki-action__copy">
              <strong>{t('moki.openFile')}</strong>
              <small>{t('moki.openFileDesc')}</small>
            </span>
            <kbd>Ctrl + O</kbd>
          </button>
          <button type="button" className="moki-action" onClick={openFolderDialog}>
            <FolderOpenOutlined />
            <span className="moki-action__copy">
              <strong>{t('moki.openFolder')}</strong>
              <small>{t('moki.openFolderDesc')}</small>
            </span>
            <ArrowRightOutlined />
          </button>
        </div>
        <div className="moki-recent">
          <h2>{t('moki.recent')}</h2>
          {recent.length ? (
            recent.map((file) => (
              <Tooltip key={file.path} title={file.path} placement="top" mouseEnterDelay={0.3}>
                <button
                  type="button"
                  onClick={() => openFileFromPath(file.path, file.name)}
                >
                  <FileTextOutlined />
                  <span>{file.name}</span>
                  <ArrowRightOutlined />
                </button>
              </Tooltip>
            ))
          ) : (
            <p>{t('moki.noRecent')}</p>
          )}
        </div>
      </div>
      {display !== 'hidden' && (
        <div className="moki-welcome__visual">
          <div className="moki-welcome__orbit" aria-hidden="true" />
          <MokiAmbient />
          <MokiSprite />
          <div className="moki-welcome__caption">
            <strong>Moki / 墨笺</strong>
            <span>{t('moki.caption')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
