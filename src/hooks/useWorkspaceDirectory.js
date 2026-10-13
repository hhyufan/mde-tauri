import { useEffect, useRef } from 'react';
import useFileStore from '@store/useFileStore';
import useNotificationStore from '@store/useNotificationStore';
import { getDirectoryContents, isSafUri, onDirectoryChanged, startDirectoryWatching, stopDirectoryWatching } from '@utils/tauriApi';
import { sortDirectoryContents } from '@utils/directoryContents';
import i18n from '@/i18n';

// Mount once in App. File action consumers must not own native watchers.
export function useWorkspaceDirectory(isAndroid) {
  const currentDir = useFileStore((state) => state.currentDir);
  const transitions = useRef(Promise.resolve());

  useEffect(() => {
    if (isAndroid || !currentDir || isSafUri(currentDir)) return undefined;
    let disposed = false;
    let started = false;
    let timer;
    let revision = 0;
    let refreshing = false;
    let refreshAgain = false;
    const report = (error) => {
      if (!disposed) useNotificationStore.getState().notify('error', i18n.t('notification.error'), String(error));
    };

    const refresh = async () => {
      if (disposed) return;
      if (refreshing) { refreshAgain = true; return; }
      refreshing = true;
      const requestRevision = revision;
      try {
        const contents = await getDirectoryContents(currentDir);
        const state = useFileStore.getState();
        if (!disposed && state.currentDir === currentDir && revision === requestRevision) {
          state.setFiles(sortDirectoryContents(contents, state));
        }
      } catch (error) { report(error); }
      finally {
        refreshing = false;
        if (refreshAgain) { refreshAgain = false; void refresh(); }
      }
    };

    const unlisten = onDirectoryChanged(({ dir }) => {
      if (disposed || dir !== currentDir) return;
      revision += 1;
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    }).catch((error) => { report(error); return () => {}; });

    // Serialize start/stop across rapid navigation and StrictMode remounts.
    // An old asynchronous stop must never remove a newer watcher for that path.
    transitions.current = transitions.current.then(async () => {
      if (disposed) return;
      started = await startDirectoryWatching(currentDir);
    }).catch(report);

    return () => {
      disposed = true;
      clearTimeout(timer);
      void unlisten.then((stopListening) => stopListening())
        .catch((error) => console.warn('[workspace] Failed to unsubscribe directory events:', error));
      transitions.current = transitions.current.then(() => {
        if (started) return stopDirectoryWatching(currentDir);
      }).catch((error) => console.warn('[workspace] Failed to stop directory watcher:', error));
    };
  }, [currentDir, isAndroid]);
}
