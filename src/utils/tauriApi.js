import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isSafUri,
  listFolder as safListFolder,
  statUri as safStatUri,
  readFileText as safReadFileText,
  writeFileText as safWriteFileText,
  createFileUnder as safCreateFileUnder,
  deleteUri as safDeleteUri,
  renameUriTo as safRenameUriTo,
  resolveChild as safResolveChild,
  childExists as safChildExists,
  openInFileManager as safOpenInFileManager,
  safDisplayName,
} from '@utils/androidSaf';

// Lazily resolve the current window. On Android (and in any environment where
// `__TAURI_INTERNALS__` isn't yet populated when this module is first imported)
// calling `getCurrentWindow()` at the top level would throw synchronously and
// take the entire React tree down with it — producing a blank/white screen
// with no visible error. Wrapping it in a Proxy defers the lookup to the
// first real property access, and any failure surfaces at the call site
// instead of at module-load time.
let _appWindow = null;
function resolveAppWindow() {
  if (_appWindow) return _appWindow;
  try {
    _appWindow = getCurrentWindow();
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[tauriApi] getCurrentWindow() failed:', err);
    }
    _appWindow = null;
  }
  return _appWindow;
}

export const appWindow = new Proxy(
  {},
  {
    get(_, prop) {
      const win = resolveAppWindow();
      if (!win) {
        if (prop === 'then') return undefined;
        return () => Promise.resolve();
      }
      const value = win[prop];
      return typeof value === 'function' ? value.bind(win) : value;
    },
  }
);

// Re-export the URI helpers so call sites don't have to import from both
// `tauriApi` and `androidSaf` to special-case mobile.
export { isSafUri, safDisplayName };

function detectLineEnding(content) {
  if (typeof content !== 'string' || content.length === 0) return 'LF';
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/\n/g) || []).length - crlf;
  const cr = (content.match(/\r/g) || []).length - crlf;
  if (crlf > 0 && crlf >= lf && crlf >= cr) return 'CRLF';
  if (cr > 0 && cr >= lf) return 'CR';
  return 'LF';
}

// ---------------------------------------------------------------------
// Path-routed APIs.
//
// On Android, paths chosen via the SAF folder/file picker are `content://`
// URIs, not real filesystem paths — the Rust commands cannot stat them.
// We sniff for that scheme here and dispatch to the Kotlin SAF bridge
// instead, so the rest of the app (useFileManager, FileTree, syncEngine…)
// never has to special-case mobile.
// ---------------------------------------------------------------------

export async function readFileContent(path) {
  if (isSafUri(path)) {
    try {
      const { content, encoding, lineEnding, size } = await safReadFileText(path);
      const fileName = safDisplayName(path);
      return {
        success: true,
        message: 'File read successfully',
        content,
        file_path: path,
        file_name: fileName,
        encoding,
        line_ending: lineEnding,
        size,
      };
    } catch (e) {
      return {
        success: false,
        message: `Failed to read file: ${e?.message || e}`,
      };
    }
  }
  return invoke('read_file_content', { path });
}

export async function writeFileContent(path, content) {
  if (isSafUri(path)) {
    await safWriteFileText(path, content);
    return;
  }
  return invoke('write_file_content', { path, content });
}

export async function saveFile(filePath, content, encoding) {
  if (isSafUri(filePath)) {
    try {
      const result = await safWriteFileText(filePath, content);
      return {
        success: true,
        message: 'File saved successfully',
        file_path: filePath,
        file_name: safDisplayName(filePath),
        encoding: encoding || 'UTF-8',
        line_ending: detectLineEnding(content),
        size: result?.size,
      };
    } catch (e) {
      return {
        success: false,
        message: `Failed to save file: ${e?.message || e}`,
      };
    }
  }
  return invoke('save_file', { filePath, content, encoding });
}

export async function checkFileExists(path) {
  if (isSafUri(path)) {
    // Pure existence-check on a content URI requires either a stat()
    // (which throws on missing) or — when we know the parent — a name lookup.
    // The current call sites always pass an absolute child URI, so a `stat`
    // probe is correct.
    try {
      const info = await safStatUri(path);
      return !!info;
    } catch (_) {
      return false;
    }
  }
  return invoke('check_file_exists', { path });
}

export async function getFileInfo(path) {
  if (isSafUri(path)) {
    const info = await safStatUri(path);
    if (!info) throw new Error('Stat failed');
    return info;
  }
  return invoke('get_file_info', { path });
}

export async function getDirectoryContents(dirPath) {
  if (isSafUri(dirPath)) {
    return safListFolder(dirPath);
  }
  return invoke('get_directory_contents', { dirPath });
}

export async function renameFile(oldPath, newPath) {
  if (isSafUri(oldPath)) {
    // newPath is either a sibling child URI (same parent, different name)
    // or — more commonly — just the new display name. SAF only supports
    // renaming a document in place, not moving across folders.
    try {
      // Extract just the display name from newPath if it looks like a path
      const newName = isSafUri(newPath)
        ? safDisplayName(newPath)
        : (newPath.split(/[\\/]/).pop() || newPath);
      const resultUri = await safRenameUriTo(oldPath, newName);
      return {
        success: true,
        message: 'File renamed successfully',
        file_path: resultUri || oldPath,
        file_name: newName,
      };
    } catch (e) {
      return {
        success: false,
        message: `Failed to rename file: ${e?.message || e}`,
      };
    }
  }
  return invoke('rename_file', { oldPath, newPath });
}

export async function deleteFile(path) {
  if (isSafUri(path)) {
    const ok = await safDeleteUri(path);
    return {
      success: ok,
      message: ok ? 'Deleted successfully' : 'Failed to delete',
      file_path: ok ? path : undefined,
    };
  }
  return invoke('delete_file', { path });
}

export async function startFileWatching(filePath) {
  // SAF documents don't expose a usable inotify path. We can poll
  // `statUri` but that's expensive and almost nobody edits a file
  // externally while it's open in the editor on Android — skipping
  // the watcher entirely keeps the IO contract simple and matches
  // what useFileManager already does behind the `isAndroid` flag.
  if (isSafUri(filePath)) return false;
  return invoke('start_file_watching', { filePath });
}

export async function stopFileWatching(filePath) {
  if (isSafUri(filePath)) return false;
  return invoke('stop_file_watching', { filePath });
}

export async function executeFile(filePath) {
  return invoke('execute_file', { filePath });
}

export async function runCodeSnippet(code, language) {
  return invoke('run_code_snippet', { code, language });
}

export async function searchFiles(dirPath, query, searchContent = false, maxResults = 100) {
  if (isSafUri(dirPath)) {
    // SAF tree walking is several orders of magnitude slower than `std::fs`
    // (each subdir = a new ContentResolver query), and full-text content
    // search would be unusable in practice. We do a *single-level* name
    // search inside the current tree so the search palette stays useful
    // for "find the file in this folder" cases.
    try {
      const q = (query || '').toLowerCase();
      if (!q) return [];
      const children = await safListFolder(dirPath);
      const matches = [];
      for (const c of children) {
        if (matches.length >= maxResults) break;
        if (c.name.toLowerCase().includes(q)) {
          matches.push({
            name: c.name,
            path: c.path,
            is_dir: !!c.is_dir,
            matched_line: null,
            line_number: null,
          });
        }
      }
      return matches;
    } catch (_) {
      return [];
    }
  }
  return invoke('search_files', { dirPath, query, searchContent, maxResults });
}

export async function showInExplorer(path) {
  if (isSafUri(path)) {
    const ok = await safOpenInFileManager(path);
    if (!ok) {
      throw new Error('Failed to open in system file manager');
    }
    return 'Opened in file manager';
  }
  return invoke('show_in_explorer', { path });
}

export async function showMainWindow() {
  return invoke('show_main_window');
}

export async function getAppDocumentsDir() {
  return invoke('get_app_documents_dir');
}

export function onFileChanged(callback) {
  return listen('file-changed', (event) => callback(event.payload));
}
