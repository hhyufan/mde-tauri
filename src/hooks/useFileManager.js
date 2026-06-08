/**
 * 文件管理主 Hook 模块。
 *
 * 该模块统一协调编辑器标签、Tauri 文件系统 API、Android SAF、自动保存、
 * 文件监视、资源管理器目录视图以及云同步引擎，是应用中文件 I/O 能力的核心入口。
 * 对调用方而言，它屏蔽了桌面端路径、Android `content://` URI 与纯云端文档之间的差异，
 * 只暴露一组可直接调用的高层文件动作。
 */
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

/**
 * 文件管理核心 Hook。
 *
 * 统一封装文件打开、保存、目录加载、拖放导入、Android SAF 适配、
 * 自动保存与云同步衔接，是编辑器和文件系统之间的主桥接层。
 */
/**
 * 根据现有路径格式推断应使用的分隔符。
 *
 * @param {string} path 现有路径。
 * @returns {string} Windows 风格返回 `\`，否则返回 `/`。
 */
function getPathSeparator(path) {
  return path.includes('\\') ? '\\' : '/';
}

/**
 * 轻量路径拼接。
 *
 * 对普通本地路径按平台分隔符拼接；对 SAF URI 仅保留一个兜底字符串形式，
 * 真正需要创建子文档时仍应走下方 SAF 专用辅助逻辑。
 */
function joinPath(dirPath, fileName) {
  if (!dirPath) return fileName;
  // SAF tree URI 不能像普通路径那样直接用斜杠拼出真实子 URI；真正可写的
  // 子文档 URI 必须通过 DocumentsContract/Bridge 获取，因此需要创建子文件时
  // 应调用本文件中的 SAF 专用辅助逻辑，而不是只做字符串拼接。
  if (isSafUri(dirPath)) return `${dirPath}/${encodeURIComponent(fileName)}`;
  const sep = getPathSeparator(dirPath);
  return `${dirPath.replace(/[\\/]+$/, '')}${sep}${fileName}`;
}

/**
 * 规范化路径文本，用于大小写不敏感的等值比较。
 *
 * @param {string} path 原始路径。
 * @returns {string} 去掉尾部分隔符并转小写后的路径。
 */
function normalizePath(path) {
  return (path || '').replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * 将文件名拆分为基础名和扩展名。
 *
 * @param {string} fileName 完整文件名。
 * @returns {{base: string, ext: string}} 拆分结果。
 */
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

/**
 * 为未命名标签生成适合保存对话框使用的建议文件名。
 *
 * @param {object | null | undefined} tab 标签对象。
 * @returns {string} 带扩展名的建议文件名。
 */
function ensureSuggestedFileName(tab) {
  const rawName = (tab?.name || '').trim() || 'Untitled';
  if (rawName.includes('.')) return rawName;
  const ext = (tab?.ext || 'md').replace(/^\.+/, '');
  return ext ? `${rawName}.${ext}` : rawName;
}

/**
 * 从 store 中读取标签的最新快照，并以缓冲区内容覆盖落后的正文。
 *
 * @param {string} tabId 标签 id。
 * @returns {object | null} 含最新内容与修改状态的标签对象。
 */
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

/**
 * 判断当前界面是否正处于已打开目录的资源管理器视图。
 *
 * @returns {boolean} 当前存在可直接保存的 Explorer 目录时返回 `true`。
 */
function hasOpenExplorerDirectory() {
  const { sidebarVisible, sidebarView } = useEditorStore.getState();
  const currentDir = useFileStore.getState().currentDir;
  return Boolean(currentDir && sidebarVisible && sidebarView === 'explorer');
}

/**
 * 返回文件管理动作集合。
 *
 * 该 Hook 本身不暴露 React 状态，而是利用 store + Tauri API 的组合能力，
 * 提供一组跨平台、可在任意组件中安全调用的文件操作函数。
 */
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

  // 解析并缓存应用专属 Documents 目录。Android 上它通常位于
  // `/data/data/com.mde.app/files/Documents`，是无需额外权限或 SAF
  // 即可稳定写入的位置；桌面端通常不走这里，因为用户可以通过对话框自由选路。
  /**
   * 解析并缓存应用私有 Documents 目录。
   *
   * @returns {Promise<string | null>} 可写目录路径；失败时返回 `null`。
   */
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

  /**
   * 创建新文件入口。
   *
   * 若当前已打开目录，则切换为 Explorer 内联新建流程；否则创建未命名标签。
   *
   * @returns {void}
   */
  const createNewFile = useCallback(() => {
    const currentDir = useFileStore.getState().currentDir;
    if (currentDir) {
      window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      return;
    }
    createUntitledTab();
  }, []);

  // Android 没有可直接复用的原生选目录对话框，而公共存储目录又依赖权限或 SAF。
  // 首次初始化时自动挂载应用私有 Documents 目录，让资源管理器和“保存”动作
  // 从一开始就拥有真实且可持久化的落点。
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
          // 这里只做尽力初始化。Rust 命令已保证目录存在；若仍失败，用户可以
          // 稍后通过资源管理器工具栏手动重试。
        }
      }
    })();
  }, [ensureAndroidDocsDir, isAndroid]);

  /**
   * 面向本地文件的防抖自动保存器。
   *
   * @returns {(filePath: string, content: string, encoding: string, meta?: object) => void} 防抖后的保存函数。
   */
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

  // 本地文件和“仅云端存在”的 external tab 走两条自动保存链路：
  // 前者落盘并入同步队列，后者直接更新远端文档快照。
  /**
   * 面向纯云端 external 标签的防抖同步器。
   *
   * @returns {(tabId: string, fileId: string, content: string, encoding: string, meta?: object) => void} 防抖后的同步函数。
   */
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

  /**
   * 触发当前活动标签的自动保存或自动同步。
   *
   * @returns {void}
   */
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

  /**
   * 按当前 Explorer 排序配置整理目录项列表。
   *
   * @param {Array<object>} contents 原始目录项列表。
   * @returns {Array<object>} 排序后的新数组。
   */
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

  /**
   * 加载指定目录，并同步更新当前目录与文件列表。
   *
   * @param {string} dirPath 目标目录路径或 SAF tree URI。
   * @returns {Promise<void>}
   */
  const loadDirectory = useCallback(async (dirPath) => {
    try {
      const contents = await getDirectoryContents(dirPath);
      setFiles(sortDirectoryContents(contents));
      setCurrentDir(dirPath);
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [sortDirectoryContents]);

  /**
   * 仅刷新目录内容，不推进目录导航历史。
   *
   * 供回退/前进逻辑复用，避免在“回到上一级目录”时再写入一条新的历史项。
   */
  // 仅重载目标目录文件列表，不修改导航历史；回退/前进逻辑会自行维护历史指针。
  /**
   * 仅刷新目录文件列表，不修改当前目录导航状态。
   *
   * @param {string} dirPath 目标目录路径或 SAF tree URI。
   * @returns {Promise<void>}
   */
  const loadFilesOnly = useCallback(async (dirPath) => {
    try {
      const contents = await getDirectoryContents(dirPath);
      setFiles(sortDirectoryContents(contents));
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [sortDirectoryContents]);

  // 供 TabBar 的 “+” 和资源管理器工具栏的 “+” 复用：
  // 若当前已打开目录，则触发资源管理器内联新建文件；
  // 若尚未打开目录，则先加载目录，再展示资源管理器内联输入框。
  /**
   * 通过目录选择或现有 Explorer 目录触发“新建文件”流程。
   *
   * @returns {Promise<void>}
   */
  const createFileWithDialog = useCallback(async () => {
    const currentDir = useFileStore.getState().currentDir;
    if (currentDir) {
      window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      return;
    }

    if (isAndroid) {
      // 优先走 SAF 目录选择器，让用户可访问 Documents、Downloads、SD 卡
      // 或云端 DocumentsProvider；若 SAF bridge 不可用，再回退到应用私有
      // Documents 目录，保持旧行为而不是直接退回未命名标签。
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
      // 等一帧让 React 根据新的 currentDir 完成渲染，再展示内联输入框。
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('explorer:newFileRequest'));
      });
    } catch (err) {
      notify('error', t('notification.error'), String(err));
    }
  }, [createUntitledTab, ensureAndroidDocsDir, isAndroid, loadDirectory, notify, t]);

  /**
   * 在标签首次获得真实保存路径后，统一完成状态回写与同步登记。
   *
   * @param {object} tab 被保存的标签对象。
   * @param {string} path 新路径或 SAF URI。
   * @param {string} [source='manual-save'] 保存来源标识。
   * @returns {Promise<void>}
   */
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

  /**
   * 将未命名标签真正持久化到磁盘或 SAF 文档树。
   *
   * 桌面端优先走 Save As；Android 优先落到应用文档目录或当前 Explorer
   * 目录，从而保证首次保存始终能产生一个可同步、可再次打开的真实路径。
   */
  /**
   * 为未命名文件生成一个不会与现有条目冲突的目标路径。
   *
   * @param {string} dirPath 父目录路径或 SAF tree URI。
   * @param {string} fileName 建议文件名。
   * @returns {Promise<string>} 可直接用于保存的唯一路径或子文档 URI。
   */
  const buildUniqueUntitledPath = useCallback(async (dirPath, fileName) => {
    const { base, ext } = splitFileName(fileName);

    // SAF tree URI 不能像普通路径那样直接拼出子 URI。这里先用 `safChildExists`
    // 探测候选文件名，再创建一个空文档，拿到真正可写的 `content://...` 子 URI。
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
        // 最差情况下，后续 `saveFile()` 会抛出真实错误；这里保留一个可继续执行
        // 的兜底路径，避免保存流程卡死在“无法生成目标路径”上。
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

  /**
   * 将未命名标签持久化为真实文件。
   *
   * @param {object} tab 待保存标签。
   * @param {{allowDialog?: boolean, source?: string}} [options={}] 保存选项。
   * @returns {Promise<string | null>} 保存成功后的路径；失败或取消时返回 `null`。
   */
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
        // Android 没有可直接使用的原生保存对话框，因此回退到应用私有
        // Documents 目录，并自动为重名文件追加序号，确保首次保存一定能真正落盘。
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

  /**
   * 按路径或 URI 打开文件，并根据来源选择本地或 external 标签模式。
   *
   * @param {string} filePath 本地路径、SAF URI 或云路径。
   * @param {string} fileName 展示文件名。
   * @returns {Promise<void>}
   */
  const openFileFromPath = useCallback(async (filePath, fileName) => {
    // 纯云端书签没有本地文件，只存在于 external 文档缓存区。此时应以
    // external 标签打开；首次保存再走另存为并把本地路径登记到服务端。
    if (isCloudPath(filePath)) {
      const fileId = fileIdFromCloudPath(filePath);
      // 自愈策略：若 fullSync 没把正文缓存下来，或这是重装后的首次访问，
      // 则在这里按需补拉一次远端正文。
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

  /**
   * 在当前 Explorer 目录下创建新文件，并在成功后立即打开。
   *
   * @param {string} fileName 用户输入的目标文件名。
   * @returns {Promise<{ok: boolean, path?: string}>} 创建结果。
   */
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
      // SAF 场景下要通过 bridge 直接创建文档，拿到真实子 URI；同时让
      // DocumentsProvider 自己负责校验非法字符等命名规则，而不是拖到写入时再报错。
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

  /**
   * 打开文件选择对话框，并将选中的文件载入编辑器。
   *
   * @returns {Promise<void>}
   */
  const openFileDialog = useCallback(async () => {
    try {
      // Android 上 Tauri 的打开文件对话框虽然可用，但过滤能力有限；直接用
      // SAF 选择器可带来更完整的 Files/Drive/Recents 体验，并拿到可持久化 URI
      // 授权，后续再次打开同一文件无需重复授权。
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

  /**
   * 手动保存入口。
   *
   * 统一处理本地标签、外部云文档和未命名标签三类情况，让调用方不必感知
   * 底层的保存落点和同步分支差异。
   */
  /**
   * 保存指定标签或当前活动标签。
   *
   * @param {string} [tabId] 目标标签 id；省略时保存当前活动标签。
   * @returns {Promise<{ok: boolean, tabId?: string, cancelled?: boolean}>} 保存结果。
   */
  const saveTab = useCallback(async (tabId) => {
    // 实时正文保存在 editorBuffer 中，`tab.content` 只是上一次持久化的快照。
    // 这里统一通过 getLiveTabById 取最新缓冲内容，避免把过期正文落盘/推云
    // （尤其是云端文档“认领”落盘时，会把旧内容推到云，导致新编辑丢失）。
    const activeId = useEditorStore.getState().activeTabId;
    const tab = getLiveTabById(tabId || activeId);
    if (!tab) return { ok: false };

    if (!tab.path) {
      // 未命名草稿与纯云端文档共用同一条“首次保存”链路：写入真实文件后，
      // `finalizeSavedTab` 会对带有 externalFileId 的云端文档执行 claim——
      // 落盘、登记本地路径(增加 fileId 绑定)，并把它从纯云端列表中取走，
      // 而不是再次触发整篇内容回推同步。
      // Android 会自动把标签落到应用私有 Documents 目录；桌面端则弹出
      // 保存对话框。两条路径最终都会写入真实文件，不再停留在“只有草稿”的死胡同。
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

  /**
   * 保存当前活动标签。
   *
   * @returns {Promise<void>}
   */
  const saveCurrentFile = useCallback(async () => {
    await saveTab();
  }, [saveTab]);

  /**
   * 触发“另存为”流程，为当前标签选择新的落点。
   *
   * @returns {Promise<void>}
   */
  const saveAsDialog = useCallback(async () => {
    const tab = useEditorStore.getState().getActiveTab();
    if (!tab) return;

    if (!tab.path && !tab.externalFileId) {
      dismissedAutoSavePromptRef.current.delete(tab.id);
    }

    try {
      // Android 没有统一可用的原生另存为对话框，因此回退到应用私有 Documents
      // 目录，并对重名文件自动补上 “ (n)” 后缀，避免静默覆盖。
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

  /**
   * 在系统文件管理器中定位目标路径。
   *
   * @param {string} path 本地路径或 SAF URI。
   * @returns {Promise<void>}
   */
  const openInExplorer = useCallback(async (path) => {
    // Android 仅能对 SAF URI 交给系统 DocumentsUI 打开；私有 `/data/data`
    // 目录既不能被 DocumentsUI 浏览，也没有合适的系统 Intent 可以跳转。
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

  /**
   * 打开目录选择对话框，并将所选目录加载到 Explorer。
   *
   * @returns {Promise<void>}
   */
  const openFolderDialog = useCallback(async () => {
    if (isAndroid) {
      // SAF 目录选择器会返回可持久化的 `content://` tree URI，并直接作为
      // currentDir 使用；Kotlin 侧已申请持久权限，因此重启应用后仍可访问。
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
      // 若 bridge 不可用，例如旧版构建环境，则退回应用私有目录。
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

  /**
   * 将拖入的文件路径逐个在编辑器中打开。
   *
   * @param {string[]} [paths=[]] 拖入路径列表。
   * @returns {Promise<void>}
   */
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

  /**
   * 将拖入路径移动到当前 Explorer 目录，并更新相关标签与书签引用。
   *
   * @param {string[]} [paths=[]] 拖入路径列表。
   * @returns {Promise<void>}
   */
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
