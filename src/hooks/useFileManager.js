import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  getAppDocumentsDir,
  isSafUri,
  safDisplayName,
} from '@utils/tauriApi';
import {
  isAndroidSafAvailable,
  pickFolder as safPickFolder,
  pickFile as safPickFile,
  childExists as safChildExists,
  createFileUnder as safCreateFileUnder,
} from '@utils/androidSaf';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import useNotificationStore from '@store/useNotificationStore';
import useExternalDocsStore from '@store/useExternalDocsStore';
import { syncEngine, isCloudPath, fileIdFromCloudPath } from '@/services/syncEngine';
import { getBuffer } from '@utils/editorBuffer';
import { debounce } from '@utils/debounce';
import { isAndroidRuntime } from '@utils/platform';
import i18n from '@/i18n';

function getPathSeparator(path) {
  return path.includes('\\') ? '\\' : '/';
}

function joinPath(dirPath, fileName) {
  if (!dirPath) return fileName;
  // SAF tree URIs are not slash-joinable — child URIs are obtained via
  // DocumentsContract, not by string concatenation. Call sites that need
  // a real child URI must use the SAF-aware helpers in this file instead.
  if (isSafUri(dirPath)) return `${dirPath}/${encodeURIComponent(fileName)}`;
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
  const isAndroid = isAndroidRuntime();
  const pendingUntitledSaveRef = useRef(new Set());
  const dismissedAutoSavePromptRef = useRef(new Set());
  const androidDocsDirRef = useRef(null);
  const androidBootstrappedRef = useRef(false);

  // Resolve (and cache) the per-app Documents folder. On Android this is
  // `/data/data/com.mde.app/files/Documents` — the only location that's
  // writable without runtime permissions or SAF. On desktop this is the
  // platform-conventional appdata folder; we never call it there because
  // the user can pick any path via dialogs.
  const ensureAndroidDocsDir = useCallback(async () => {
    if (androidDocsDirRef.current) return androidDocsDirRef.current;
    try {
      const dir = await getAppDocumentsDir();
      androidDocsDirRef.current = dir;
      return dir;
    } catch (err) {
      notify('error', t('notification.error'), String(err));
      return null;
    }
  }, [notify, t]);

  const createNewFile = useCallback(() => {
    const currentDir = useFileStore.getState().currentDir;
    if (currentDir) {
      window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      return;
    }
    createUntitledTab();
  }, []);

  // On Android there is no folder-picker dialog and the public storage
  // directories require permissions/SAF that Tauri's default plugins
  // don't expose. Auto-mount the per-app Documents directory as the
  // current working folder the first time the hook initializes — the
  // explorer panel then becomes immediately useful and "Save" can target
  // a real, persistent path without any extra UI.
  useEffect(() => {
    if (!isAndroid || androidBootstrappedRef.current) return;
    androidBootstrappedRef.current = true;

    (async () => {
      const dir = await ensureAndroidDocsDir();
      if (!dir) return;
      const { currentDir } = useFileStore.getState();
      if (!currentDir) {
        try {
          const contents = await getDirectoryContents(dir);
          useFileStore.getState().setFiles(contents);
          useFileStore.getState().setCurrentDir(dir);
        } catch (_) {
          // best-effort — directory exists because the Rust command
          // creates it; if we still fail here, the user can retry
          // manually via the explorer toolbar.
        }
      }
    })();
  }, [ensureAndroidDocsDir, isAndroid]);

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

    if (isAndroid) {
      // Prefer the SAF folder picker so the user can choose any directory
      // (Documents, Downloads, an SD card mount, a cloud DocumentsProvider…).
      // Fall back to the per-app Documents folder if SAF isn't reachable
      // (e.g. the bridge failed to inject), which preserves the previous
      // behaviour rather than dropping the user onto an untitled tab.
      if (isAndroidSafAvailable()) {
        try {
          const treeUri = await safPickFolder();
          if (!treeUri) return;
          await loadDirectory(treeUri);
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
          });
          return;
        } catch (err) {
          notify('error', t('notification.error'), String(err));
          return;
        }
      }
      const dir = await ensureAndroidDocsDir();
      if (!dir) {
        createUntitledTab();
        return;
      }
      await loadDirectory(dir);
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      });
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
  }, [createUntitledTab, ensureAndroidDocsDir, isAndroid, loadDirectory, notify, t]);

  const finalizeSavedTab = useCallback(async (tab, path, source = 'manual-save') => {
    const name = path.split(/[\\/]/).pop();
    const ext = name.split('.').pop() || '';
    const currentDir = useFileStore.getState().currentDir;
    const externalFileId = tab.externalFileId;

    updateTabPath(tab.id, path, name);
    markTabSaved(path);
    addRecentFile({ name, path, ext });
    if (!isAndroid) startFileWatching(path).catch(() => {});
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
  }, [addRecentFile, isAndroid, loadDirectory, markTabSaved, notify, t, updateTabPath]);

  const buildUniqueUntitledPath = useCallback(async (dirPath, fileName) => {
    const { base, ext } = splitFileName(fileName);

    // SAF tree URIs can't be string-joined into child URIs. Probe child
    // names with `safChildExists` (cheap — single ContentResolver query
    // per probe), then create an empty document with the unique name so
    // we get back a real `content://…/document/…` URI to hand to saveFile.
    if (isSafUri(dirPath)) {
      let candidate = fileName;
      let index = 1;
      while (safChildExists(dirPath, candidate)) {
        index += 1;
        candidate = `${base} (${index})${ext}`;
      }
      try {
        const childUri = await safCreateFileUnder(dirPath, candidate);
        return childUri || joinPath(dirPath, candidate);
      } catch (_) {
        // Worst case the caller's subsequent saveFile() will surface the
        // real error, but keeping a usable fallback prevents the save
        // flow from getting stuck in a loop.
        return joinPath(dirPath, candidate);
      }
    }

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
      } else if (isAndroid) {
        // No native save dialog on Android. Fall back to the per-app
        // Documents folder + an auto-deduplicated filename so the user's
        // first Ctrl+S / save tap actually persists the draft instead of
        // bouncing off a notification toast.
        const dir = await ensureAndroidDocsDir();
        if (!dir) return null;
        const suggestedName = ensureSuggestedFileName(tab);
        targetPath = await buildUniqueUntitledPath(dir, suggestedName);
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
  }, [buildUniqueUntitledPath, ensureAndroidDocsDir, finalizeSavedTab, isAndroid, notify, t]);

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
        if (!isAndroid) startFileWatching(filePath).catch(() => {});
      } else {
        notify('error', t('notification.error'), result.message);
      }
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [isAndroid]);

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
      // SAF: create the document via the bridge so we get a real child URI
      // back; sticking to a single createDocument call also lets the
      // DocumentsProvider enforce its own naming rules (e.g. illegal chars
      // in filename) instead of failing later in writeFile.
      if (isSafUri(currentDir)) {
        if (safChildExists(currentDir, trimmed)) {
          notify('error', t('notification.error'), t('sidebar.explorer.fileExists'));
          return { ok: false };
        }
        const childUri = await safCreateFileUnder(currentDir, trimmed);
        if (!childUri) {
          notify('error', t('notification.error'), t('sidebar.explorer.invalidFileName'));
          return { ok: false };
        }
        await loadDirectory(currentDir);
        await openFileFromPath(childUri, trimmed);
        notify('success', t('notification.fileCreated'), trimmed);
        return { ok: true, path: childUri };
      }

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
      // On Android the Tauri dialog plugin's "open file" works but limits
      // us to its built-in mime filters; using the SAF picker directly
      // gives the user a richer chooser (Files / Drive / Recents) plus
      // a persisted URI grant, so subsequent opens of the same file don't
      // re-prompt.
      if (isAndroid && isAndroidSafAvailable()) {
        const uri = await safPickFile([
          'text/markdown',
          'text/plain',
          'application/json',
          'text/*',
          'application/octet-stream',
          '*/*',
        ]);
        if (!uri) return;
        await openFileFromPath(uri, safDisplayName(uri));
        return;
      }

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
  }, [isAndroid, notify, openFileFromPath, t]);

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
      // Android: persistUntitledTab now resolves to the per-app
      // Documents folder automatically (no dialog needed). Desktop:
      // surface a Save dialog. Either way, we end up writing real bytes
      // to disk — no more "unsaved draft" dead-end notification.
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
  }, [isAndroid, notify, persistUntitledTab, t]);

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
      // Android has no native save-file dialog. Fall back to the per-app
      // Documents folder with the suggested filename — duplicates get a
      // " (n)" suffix so we never silently overwrite.
      let path;
      if (isAndroid) {
        const dir = await ensureAndroidDocsDir();
        if (!dir) return;
        path = await buildUniqueUntitledPath(dir, ensureSuggestedFileName(tab));
      } else {
        path = await save({
          defaultPath: ensureSuggestedFileName(tab),
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
      }
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
  }, [
    addRecentFile,
    buildUniqueUntitledPath,
    ensureAndroidDocsDir,
    isAndroid,
    markTabSaved,
    notify,
    t,
    updateTabPath,
  ]);

  const openInExplorer = useCallback(async (path) => {
    // Android can hand off to the system DocumentsUI via Intent.ACTION_VIEW
    // for both content URIs (SAF) and the per-app Documents folder. The
    // dispatch happens inside `showInExplorer` (which checks `isSafUri`),
    // so we only need a SAF URI here. For the legacy "per-app docs" path
    // we still bail out — DocumentsUI refuses to navigate into our
    // private /data/data dir, and there's no useful Intent for it.
    if (isAndroid) {
      if (isSafUri(path)) {
        try {
          await showInExplorer(path);
        } catch (err) {
          notify('error', t('notification.error'), String(err));
        }
        return;
      }
      notify('info', t('notification.info', 'Info'), t('sidebar.explorer.openInExplorer'));
      return;
    }

    try {
      await showInExplorer(path);
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [isAndroid, notify, t]);

  const openFolderDialog = useCallback(async () => {
    if (isAndroid) {
      // SAF folder picker — returns a persistable content:// tree URI
      // that we use as currentDir. The Kotlin side has already taken the
      // persistable permission flags, so this grant survives app
      // restarts (visible in Settings → Permissions → Files).
      if (isAndroidSafAvailable()) {
        try {
          const treeUri = await safPickFolder();
          if (!treeUri) return;
          await loadDirectory(treeUri);
          return;
        } catch (err) {
          notify('error', t('notification.error'), String(err));
          return;
        }
      }
      // Bridge unavailable (older Tauri build?): fall back to per-app dir.
      const dir = await ensureAndroidDocsDir();
      if (dir) await loadDirectory(dir);
      return;
    }

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
  }, [ensureAndroidDocsDir, isAndroid, loadDirectory, notify, t]);

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
              if (!isAndroid) startFileWatching(targetPath).catch(() => {});
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
    isAndroid,
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
