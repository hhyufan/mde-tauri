import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useScriptStore, { isScriptRunning } from '@store/useScriptStore';
import { getScriptLanguage, scriptRunner } from '@/services/scriptRunner';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

export default function FloatingRunButton() {
  const { t } = useTranslation();
  const activeId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabRenderList);
  const status = useScriptStore((state) => state.status);
  const { isAndroid } = useResponsiveLayout();
  if (isAndroid || !getScriptLanguage(tabs.find((tab) => tab.id === activeId)?.name)) return null;
  const running = isScriptRunning(status);
  return <Tooltip title={running ? t('run.stopTitle') : t('console.runCurrentHint')} placement="top" mouseEnterDelay={0.3}>
    <button className={`editor-content__run${running ? ' is-running' : ''}`} type="button"
      aria-label={running ? t('run.stopCurrent') : t('run.runCurrent')}
      disabled={status === 'stopping'} onMouseDown={(event) => event.preventDefault()}
      onClick={() => running ? scriptRunner.stop() : scriptRunner.runCurrent()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {running ? <rect x="6" y="6" width="12" height="12" rx="1" /> : <path d="m8 5 11 7-11 7z" />}
      </svg>
      <span>{running ? t('console.stop') : t('console.run')}</span><kbd>{running ? '⇧ F5' : 'F5'}</kbd>
    </button>
  </Tooltip>;
}
