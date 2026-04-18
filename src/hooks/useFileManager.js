import { useCallback, useMemo } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  readFileContent,
  saveFile,
  getDirectoryContents,
  startFileWatching,
  stopFileWatching,
  onFileChanged,
  showInExplorer,
} from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import useNotificationStore from '@store/useNotificationStore';
import useExternalDocsStore from '@store/useExternalDocsStore';
import { syncEngine, isCloudPath, fileIdFromCloudPath } from '@/services/syncEngine';
import { debounce } from '@utils/debounce';

export function useFileManager() {
  const { openFile: openTab, openExternalFile, markTabSaved, updateTabContent, getActiveTab, createUntitledTab, updateTabPath } = useEditorStore.getState();
  const { setCurrentDir, setFiles, addRecentFile } = useFileStore.getState();
  const notify = useNotificationStore.getState().notify;

  const createNewFile = useCallback(() => {
    createUntitledTab();
  }, []);

  const debouncedAutoSave = useMemo(
    () => debounce(async (filePath, content, encoding) => {
      if (!filePath) return;
      try {
        const result = await saveFile(filePath, content, encoding);
        if (result.success) {
          const tab = useEditorStore.getState().getActiveTab();
          if (tab && tab.path === filePath) {
            markTabSaved(tab.id);
          }
        }
      } catch (_) { /* silent */ }
    }, 1000),
    []
  );

  const triggerAutoSave = useCallback(() => {
    const autoSave = useConfigStore.getState().autoSave;
    if (!autoSave) return;
    const tab = useEditorStore.getState().getActiveTab();
    if (!tab || !tab.path || !tab.modified) return;
    debouncedAutoSave(tab.path, tab.content, tab.encoding);
  }, [debouncedAutoSave]);

  const loadDirectory = useCallback(async (dirPath) => {
    try {
      const contents = await getDirectoryContents(dirPath);
      const sorted = contents.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(sorted);
      setCurrentDir(dirPath);
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, []);

  const openFileFromPath = useCallback(async (filePath, fileName) => {
    // Cloud-only bookmark: content lives in useExternalDocsStore, no
    // local file exists yet. Open as an external tab; first save will
    // trigger Save As + register the path on the server.
    if (isCloudPath(filePath)) {
      const fileId = fileIdFromCloudPath(filePath);
      // Self-heal: if the body wasn't cached during fullSync (or this is
      // the first time we're seeing the bookmark since reinstall), pull
      // it on demand here.
      const doc = await syncEngine.ensureExternalDoc(fileId);
      if (!doc || typeof doc.content !== 'string') {
        notify('error', 'Error', 'Cloud file content unavailable. Try syncing again.');
        return;
      }
      const displayName = doc.name || fileName || fileId;
      openExternalFile({
        fileId,
        name: displayName,
        ext: doc.ext,
        content: doc.content,
        encoding: doc.encoding,
        lineEnding: doc.lineEnding,
      });
      return;
    }

    try {
      const result = await readFileContent(filePath);
      if (result.success) {
        const ext = fileName.split('.').pop() || '';
        openTab({
          name: fileName,
          path: filePath,
          content: result.content || '',
          encoding: result.encoding || 'UTF-8',
          lineEnding: result.line_ending || 'LF',
        });
        addRecentFile({ name: fileName, path: filePath, ext });
        startFileWatching(filePath).catch(() => {});
      } else {
        notify('error', 'Error', result.message);
      }
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, []);

  const openFileDialog = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (selected) {
        const path = typeof selected === 'string' ? selected : selected.path;
        const name = path.split(/[\\/]/).pop();
        await openFileFromPath(path, name);
      }
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, [openFileFromPath]);

  const saveCurrentFile = useCallback(async () => {
    const tab = useEditorStore.getState().getActiveTab();
    if (!tab) return;

    if (!tab.path) {
      try {
        const path = await save({
          defaultPath: tab.name,
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (path) {
          const result = await saveFile(path, tab.content, tab.encoding);
          if (result.success) {
            const name = path.split(/[\\/]/).pop();
            const ext = name.split('.').pop() || '';
            const externalFileId = tab.externalFileId;
            updateTabPath(tab.id, path, name);
            markTabSaved(path);
            addRecentFile({ name, path, ext });
            notify('success', 'File saved', name);
            // If this tab originated from a cloud-only bookmark, register
            // the freshly chosen local path under our deviceId so the
            // server (and future syncs from this device) know where it
            // lives now.
            if (externalFileId) {
              syncEngine.claimExternalDoc(externalFileId, path, tab.content, tab.encoding);
            }
          }
        }
      } catch (err) {
        notify('error', 'Error', String(err));
      }
      return;
    }

    try {
      const result = await saveFile(tab.path, tab.content, tab.encoding);
      if (result.success) {
        markTabSaved(tab.id);
        notify('success', 'File saved', tab.name);
        // Only bookmarked files participate in cloud sync.
        const bookmarked = useFileStore.getState().bookmarkedPaths.includes(tab.path);
        if (bookmarked) {
          syncEngine.pushSingle(tab.path, tab.content, tab.encoding, 'bookmark');
        }
      } else {
        notify('error', 'Error', result.message);
      }
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, []);

  const saveAsDialog = useCallback(async () => {
    const tab = useEditorStore.getState().getActiveTab();
    if (!tab) return;

    try {
      const path = await save({
        defaultPath: tab.name,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (path) {
        const result = await saveFile(path, tab.content);
        if (result.success) {
          markTabSaved(tab.id);
          notify('success', 'File saved', path);
        }
      }
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, []);

  const openInExplorer = useCallback(async (path) => {
    try {
      await showInExplorer(path);
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, []);

  const openFolderDialog = useCallback(async () => {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const dir = await openDialog({ directory: true });
      if (dir) {
        const dirPath = typeof dir === 'string' ? dir : dir.path;
        await loadDirectory(dirPath);
      }
    } catch (err) {
      notify('error', 'Error', String(err));
    }
  }, [loadDirectory]);

  return {
    loadDirectory,
    openFileFromPath,
    openFileDialog,
    openFolderDialog,
    saveCurrentFile,
    saveAsDialog,
    openInExplorer,
    createNewFile,
    triggerAutoSave,
  };
}
