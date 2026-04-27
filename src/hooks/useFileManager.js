import { useCallback, useMemo, useRef } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  readFileContent,
  saveFile,
  writeFileContent,
  checkFileExists,
  getFileInfo,
  getDirectoryContents,
  renameFile,
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
import { getBuffer } from '@utils/editorBuffer';
import { debounce } from '@utils/debounce';
import i18n from '@/i18n';

function getPathSeparator(path) {
  return path.includes('\\') ? '\\' : '/';
}

function joinPath(dirPath, fileName) {
  if (!dirPath) return fileName;
  const sep = getPathSeparator(dirPath);
  return `${dirPath.replace(/[\\/]+$/, '')}${sep}${fileName}`;
}

function normalizePath(path) {
  return (path || '').replace(/[\\/]+$/, '').toLowerCase();
}

function splitFileName(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { base: fileName, ext: '' };
  }
  return {
    base: fileName.slice(0, dotIndex),
    ext: fileName.slice(dotIndex),
  };
}

function ensureSuggestedFileName(tab) {
  const rawName = (tab?.name || '').trim() || 'Untitled';
  if (rawName.includes('.')) return rawName;
  const ext = (tab?.ext || 'md').replace(/^\.+/, '');
  return ext ? `${rawName}.${ext}` : rawName;
}

function getLiveTabById(tabId) {
  if (!tabId) return null;
  const state = useEditorStore.getState();
  const tab = state.tabs.find((item) => item.id === tabId) || null;
  if (!tab) return null;
  const meta = state.tabRenderList.find((item) => item.id === tabId);
  return {
    ...tab,
    content: getBuffer(tab.id, tab.content),
    modified: meta?.modified ?? tab.modified,
  };
}

function hasOpenExplorerDirectory() {
  const { sidebarVisible, sidebarView } = useEditorStore.getState();
  const currentDir = useFileStore.getState().currentDir;
  return Boolean(currentDir && sidebarVisible && sidebarView === 'explorer');
}

export function useFileManager() {
  const {
    openFile: openTab,
    openExternalFile,
    markTabSaved,
    getActiveTab,
    createUntitledTab,
    updateTabPath,
  } = useEditorStore.getState();
  const {
    setCurrentDir,
    setFiles,
    addRecentFile,
    replaceRecentFilePath,
    replaceBookmarkPath,
  } = useFileStore.getState();
  const notify = useNotificationStore.getState().notify;
  const t = i18n.t.bind(i18n);
  const pendingUntitledSaveRef = useRef(new Set());
  const dismissedAutoSavePromptRef = useRef(new Set());

  const createNewFile = useCallback(() => {
    const currentDir = useFileStore.getState().currentDir;
    if (currentDir) {
      window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      return;
    }
    createUntitledTab();
  }, []);

  const debouncedAutoSave = useMemo(
    () => debounce(async (filePath, content, encoding, meta = {}) => {
      if (!filePath) return;
      try {
        const result = await saveFile(filePath, content, encoding);
        if (result.success) {
          const tab = useEditorStore.getState().getActiveTab();
          if (tab && tab.path === filePath) {
            markTabSaved(tab.id);
          }
          syncEngine.registerLocalDocument(filePath, {
            name: meta.name || filePath.split(/[\\/]/).pop() || '',
            ext: meta.ext || '',
            encoding,
            lineEnding: meta.lineEnding || 'LF',
          });
          await syncEngine.queueLocalUpsert(filePath, content, encoding, {
            name: meta.name || filePath.split(/[\\/]/).pop() || '',
            lineEnding: meta.lineEnding || 'LF',
            source: 'auto-save',
          });
        }
      } catch (_) { /* silent */ }
    }, 1000),
    []
  );

  const debouncedExternalSync = useMemo(
    () => debounce(async (tabId, fileId, content, encoding, meta = {}) => {
      if (!fileId) return;
      try {
        const result = await syncEngine.queueExternalUpsert(fileId, content, encoding, {
          name: meta.name || fileId,
          lineEnding: meta.lineEnding || 'LF',
          source: 'auto-sync-external',
        });
        if (result?.ok) {
          const currentTab = useEditorStore.getState().tabs.find((item) => item.id === tabId);
          if (currentTab?.externalFileId === fileId) {
            markTabSaved(tabId);
          }
        }
      } catch (_) { /* silent */ }
    }, 1000),
    [markTabSaved]
  );

  const triggerAutoSave = useCallback(() => {
    const autoSave = useConfigStore.getState().autoSave;
    if (!autoSave) return;
    const tab = useEditorStore.getState().getActiveTab();
    if (!tab) return;
    const content = getBuffer(tab.id, tab.content);
    if (!tab.path && tab.externalFileId) {
      debouncedExternalSync(tab.id, tab.externalFileId, content, tab.encoding, {
        name: tab.name,
        lineEnding: tab.lineEnding,
      });
      return;
    }
    if (!tab.path) {
      const canSaveToExplorerDir = hasOpenExplorerDirectory();
      if (!canSaveToExplorerDir && dismissedAutoSavePromptRef.current.has(tab.id)) return;
      persistUntitledTab(tab, { allowDialog: !canSaveToExplorerDir, source: 'auto-save' });
      return;
    }
    debouncedAutoSave(tab.path, content, tab.encoding, {
      name: tab.name,
      ext: tab.ext,
      lineEnding: tab.lineEnding,
    });
  }, [debouncedAutoSave, debouncedExternalSync]);

  const sortDirectoryContents = useCallback((contents) => {
    const { sortBy, sortOrder } = useFileStore.getState();
    const direction = sortOrder === 'desc' ? -1 : 1;
    return [...contents].sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      let compareValue = 0;
      if (sortBy === 'size') {
        compareValue = (a.size || 0) - (b.size || 0);
      } else if (sortBy === 'time') {
        compareValue = (a.modified || 0) - (b.modified || 0);
      } else {
        compareValue = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      if (compareValue === 0) {
        compareValue = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      return compareValue * direction;
    });
  }, []);

  const loadDirectory = useCallback(async (dirPath) => {
    try {
      const contents = await getDirectoryContents(dirPath);
      setFiles(sortDirectoryContents(contents));
      setCurrentDir(dirPath);
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [sortDirectoryContents]);

  // Reload the file list for a dir WITHOUT touching navigation history.
  // Used by back/forward navigation which updates history themselves.
  const loadFilesOnly = useCallback(async (dirPath) => {
    try {
      const contents = await getDirectoryContents(dirPath);
      setFiles(sortDirectoryContents(contents));
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [sortDirectoryContents]);

  // Used by the TabBar "+" button and the Explorer toolbar "+" when no folder is open.
  // • Explorer has a folder open  → trigger inline new-file inside the explorer.
  // • No folder open              → show a folder-picker dialog, open that folder in
  //                                 the explorer, then create an untitled tab.
  const createFileWithDialog = useCallback(async () => {
    const currentDir = useFileStore.getState().currentDir;
    if (currentDir) {
      window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      return;
    }

    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const dir = await openDialog({ directory: true });
      if (!dir) return;

      const dirPath = typeof dir === 'string' ? dir : dir.path;
      await loadDirectory(dirPath);
      // Wait a frame for React to re-render with the new currentDir before showing the input
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      });
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [loadDirectory]);

  const finalizeSavedTab = useCallback(async (tab, path, source = 'manual-save') => {
    const name = path.split(/[\\/]/).pop();
    const ext = name.split('.').pop() || '';
    const currentDir = useFileStore.getState().currentDir;
    const externalFileId = tab.externalFileId;

    updateTabPath(tab.id, path, name);
    markTabSaved(path);
    addRecentFile({ name, path, ext });
    startFileWatching(path).catch(() => {});
    notify('success', t('notification.fileSaved'), name);

    if (externalFileId) {
      await syncEngine.claimExternalDoc(externalFileId, path, tab.content, tab.encoding);
    } else {
      syncEngine.registerLocalDocument(path, {
        name,
        ext,
        encoding: tab.encoding,
        lineEnding: tab.lineEnding,
      });
      await syncEngine.queueLocalUpsert(path, tab.content, tab.encoding, {
        name,
        lineEnding: tab.lineEnding,
        source,
      });
    }

    if (currentDir && path.startsWith(currentDir.replace(/[\\/]+$/, ''))) {
      await loadDirectory(currentDir);
    }
  }, [addRecentFile, loadDirectory, markTabSaved, notify, t, updateTabPath]);

  const buildUniqueUntitledPath = useCallback(async (dirPath, fileName) => {
    const { base, ext } = splitFileName(fileName);
    let index = 1;
    let candidate = joinPath(dirPath, fileName);
    while (await checkFileExists(candidate)) {
      index += 1;
      candidate = joinPath(dirPath, `${base} (${index})${ext}`);
    }
    return candidate;
  }, []);

  const persistUntitledTab = useCallback(async (tab, options = {}) => {
    if (!tab || tab.path) return null;
    if (pendingUntitledSaveRef.current.has(tab.id)) return null;

    pendingUntitledSaveRef.current.add(tab.id);
    try {
      const currentDir = useFileStore.getState().currentDir;
      const canSaveToExplorerDir = hasOpenExplorerDirectory();
      let targetPath = '';

      if (currentDir && canSaveToExplorerDir) {
        const suggestedName = ensureSuggestedFileName(tab);
        targetPath = await buildUniqueUntitledPath(currentDir, suggestedName);
      } else if (options.allowDialog) {
        const selected = await save({
          defaultPath: ensureSuggestedFileName(tab),
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (!selected) {
          if (options.source === 'auto-save') {
            dismissedAutoSavePromptRef.current.add(tab.id);
          }
          return null;
        }
        targetPath = selected;
      } else {
        return null;
      }

      const result = await saveFile(targetPath, tab.content, tab.encoding);
      if (!result.success) {
        notify('error', t('notification.error'), result.message);
        return null;
      }

      dismissedAutoSavePromptRef.current.delete(tab.id);
      await finalizeSavedTab(tab, targetPath, options.source === 'auto-save' ? 'auto-save' : 'save-as');
      return targetPath;
    } catch (err) {
      notify('error', t('notification.error'), String(err));
      return null;
    } finally {
      pendingUntitledSaveRef.current.delete(tab.id);
    }
  }, [buildUniqueUntitledPath, finalizeSavedTab, notify, t]);

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
        notify('error', t('notification.error'), t('notification.cloudFileContentUnavailable'));
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
        syncEngine.registerLocalDocument(filePath, {
          name: fileName,
          ext,
          encoding: result.encoding || 'UTF-8',
          lineEnding: result.line_ending || 'LF',
        });
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
        notify('error', t('notification.error'), result.message);
      }
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, []);

  const createFileInCurrentDir = useCallback(async (fileName) => {
    const currentDir = useFileStore.getState().currentDir;
    const trimmed = (fileName || '').trim();
    if (!currentDir) {
      notify('error', t('notification.error'), t('sidebar.explorer.openFolder'));
      return { ok: false };
    }
    if (!trimmed || /[\\/]/.test(trimmed)) {
      notify('error', t('notification.error'), t('sidebar.explorer.invalidFileName'));
      return { ok: false };
    }

    try {
      const targetPath = joinPath(currentDir, trimmed);
      if (await checkFileExists(targetPath)) {
        notify('error', t('notification.error'), t('sidebar.explorer.fileExists'));
        return { ok: false };
      }
      await writeFileContent(targetPath, '');
      await loadDirectory(currentDir);
      await openFileFromPath(targetPath, trimmed);
      notify('success', t('notification.fileCreated'), trimmed);
      return { ok: true, path: targetPath };
    } catch (err) {
      notify('error', t('notification.error'), String(err));
      return { ok: false };
    }
  }, [loadDirectory, notify, openFileFromPath, t]);

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
      notify('error', t('notification.error'), String(err));
    }
  }, [openFileFromPath]);

  const saveTab = useCallback(async (tabId) => {
    const tab = tabId
      ? getLiveTabById(tabId)
      : useEditorStore.getState().getActiveTab();
    if (!tab) return { ok: false };

    if (!tab.path && tab.externalFileId) {
      try {
        await syncEngine.queueExternalUpsert(tab.externalFileId, tab.content, tab.encoding, {
          name: tab.name,
          lineEnding: tab.lineEnding,
          source: 'manual-save-external',
        });
        markTabSaved(tab.id);
        notify('success', t('notification.synced'), tab.name);
        return { ok: true, tabId: tab.id };
      } catch (err) {
        notify('error', t('notification.error'), String(err));
        return { ok: false };
      }
    }

    if (!tab.path) {
      dismissedAutoSavePromptRef.current.delete(tab.id);
      const targetPath = await persistUntitledTab(tab, { allowDialog: true, source: 'manual-save' });
      return targetPath
        ? { ok: true, tabId: targetPath }
        : { ok: false, cancelled: true };
    }

    try {
      const result = await saveFile(tab.path, tab.content, tab.encoding);
      if (result.success) {
        markTabSaved(tab.id);
        notify('success', t('notification.fileSaved'), tab.name);
        syncEngine.registerLocalDocument(tab.path, {
          name: tab.name,
          ext: tab.ext,
          encoding: tab.encoding,
          lineEnding: tab.lineEnding,
        });
        await syncEngine.queueLocalUpsert(tab.path, tab.content, tab.encoding, {
          name: tab.name,
          lineEnding: tab.lineEnding,
          source: 'manual-save',
        });
        return { ok: true, tabId: tab.id };
      } else {
        notify('error', t('notification.error'), result.message);
        return { ok: false };
      }
    } catch (err) {
      notify('error', t('notification.error'), String(err));
      return { ok: false };
    }
  }, []);

  const saveCurrentFile = useCallback(async () => {
    await saveTab();
  }, [saveTab]);

  const saveAsDialog = useCallback(async () => {
    const tab = useEditorStore.getState().getActiveTab();
    if (!tab) return;

    if (!tab.path && !tab.externalFileId) {
      dismissedAutoSavePromptRef.current.delete(tab.id);
    }

    try {
      const path = await save({
        defaultPath: ensureSuggestedFileName(tab),
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
          notify('success', t('notification.fileSaved'), path);
          if (externalFileId) {
            await syncEngine.claimExternalDoc(externalFileId, path, tab.content, tab.encoding);
          } else {
            syncEngine.registerLocalDocument(path, {
              name,
              ext,
              encoding: tab.encoding,
              lineEnding: tab.lineEnding,
            });
            await syncEngine.queueLocalUpsert(path, tab.content, tab.encoding, {
              name,
              lineEnding: tab.lineEnding,
              source: 'save-as',
            });
          }
        }
      }
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, []);

  const openInExplorer = useCallback(async (path) => {
    try {
      await showInExplorer(path);
    } catch (err) {
      notify('error', t('notification.error'), String(err));
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
      notify('error', t('notification.error'), String(err));
    }
  }, [loadDirectory]);

  const openDroppedPathsInEditor = useCallback(async (paths = []) => {
    for (const filePath of paths) {
      try {
        const info = await getFileInfo(filePath);
        if (info?.is_file) {
          await openFileFromPath(info.path, info.name);
        }
      } catch (err) {
        notify('error', t('notification.error'), String(err));
      }
    }
  }, [notify, openFileFromPath, t]);

  const moveDroppedPathsToExplorer = useCallback(async (paths = []) => {
    const currentDir = useFileStore.getState().currentDir;
    if (!currentDir) {
      notify('error', t('notification.error'), t('sidebar.explorer.openFolder'));
      return;
    }

    for (const sourcePath of paths) {
      try {
        const info = await getFileInfo(sourcePath);
        const targetPath = joinPath(currentDir, info.name);
        const samePath = normalizePath(sourcePath) === normalizePath(targetPath);

        if (!samePath) {
          if (await checkFileExists(targetPath)) {
            notify('error', t('notification.error'), t('sidebar.explorer.fileExists'));
            continue;
          }

          const result = await renameFile(sourcePath, targetPath);
          if (!result.success) {
            notify('error', t('notification.error'), result.message);
            continue;
          }

          if (info.is_file) {
            const existingTab = useEditorStore.getState().getTabByPath(sourcePath);
            if (existingTab) {
              updateTabPath(existingTab.id, targetPath, info.name);
              stopFileWatching(sourcePath).catch(() => {});
              startFileWatching(targetPath).catch(() => {});
            }
            replaceRecentFilePath(sourcePath, targetPath, info.name);
            replaceBookmarkPath(sourcePath, targetPath);
          }
        }

        if (info.is_file) {
          await openFileFromPath(targetPath, info.name);
        }
      } catch (err) {
        notify('error', t('notification.error'), String(err));
      }
    }

    await loadDirectory(currentDir);
  }, [
    loadDirectory,
    notify,
    openFileFromPath,
    replaceBookmarkPath,
    replaceRecentFilePath,
    t,
    updateTabPath,
  ]);

  return {
    loadDirectory,
    loadFilesOnly,
    openFileFromPath,
    openFileDialog,
    openFolderDialog,
    saveCurrentFile,
    saveAsDialog,
    openInExplorer,
    createNewFile,
    createFileWithDialog,
    createFileInCurrentDir,
    openDroppedPathsInEditor,
    moveDroppedPathsToExplorer,
    triggerAutoSave,
    saveTab,
  };
}
