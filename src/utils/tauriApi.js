/**
 * Tauri 与 Android SAF 的统一文件能力适配层。
 *
 * 本文件对上层暴露稳定的“按路径工作”接口，并在内部根据普通文件路径与
 * `content://` SAF URI 自动分流到 Rust 命令或 Android Bridge，屏蔽平台差异。
 */
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

/**
 * Tauri/Android SAF 统一适配层。
 *
 * 对上层暴露一组“按路径工作”的文件 API；内部再根据普通文件路径还是
 * `content://` SAF URI，分别路由到 Rust 命令或 Android Bridge。
 */
// 延迟解析当前窗口对象。某些 Android/WebView 启动阶段 `__TAURI_INTERNALS__`
// 还未注入完成，如果模块顶层立即调用 `getCurrentWindow()` 会同步抛错并导致
// 整棵 React 树初始化失败；通过 Proxy 把读取时机推迟到真正访问属性时，可把
// 错误局限在调用点，而不是在模块加载期直接白屏。
let _appWindow = null;

/**
 * 延迟解析当前 Tauri 窗口对象，避免模块加载阶段因环境未就绪而直接抛错。
 *
 * @returns {import('@tauri-apps/api/window').Window | null} 当前窗口对象；不可用时返回 `null`
 */
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

/**
 * 惰性代理后的当前应用窗口对象。
 *
 * 调用方可以像直接使用 Tauri `Window` 实例一样访问其属性；当窗口对象暂不可用时，
 * 代理会返回安全的空实现，避免在启动早期打断 React 初始化。
 */
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

// 透出 URI 辅助方法，避免调用方为了兼容移动端同时依赖两个模块。
export { isSafUri, safDisplayName };

/**
 * 根据文本内容推断换行符风格，供保存结果回传统一元信息。
 */
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
// 基于路径类型分流的文件 API。
//
// Android 上通过 SAF 选择器拿到的是 `content://` URI，并不是真实文件系统
// 路径，Rust 侧命令无法直接对其执行 stat/read/write。这里集中识别并改走
// Kotlin SAF Bridge，让其余业务层继续以“路径式 API”思维工作即可。
// ---------------------------------------------------------------------

/**
 * 按路径读取文本文件内容。
 */
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

/**
 * 按路径写入纯文本内容，不返回保存元信息。
 */
export async function writeFileContent(path, content) {
  if (isSafUri(path)) {
    await safWriteFileText(path, content);
    return;
  }
  return invoke('write_file_content', { path, content });
}

/**
 * 保存文件并返回统一格式的保存结果。
 */
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

/**
 * 判断指定路径是否存在。
 */
export async function checkFileExists(path) {
  if (isSafUri(path)) {
    // 对 `content://` 做纯存在性判断时，最稳妥的方式是直接 `stat` 一次；
    // 当前调用点传入的都是完整子 URI，因此无需额外父目录上下文。
    try {
      const info = await safStatUri(path);
      return !!info;
    } catch (_) {
      return false;
    }
  }
  return invoke('check_file_exists', { path });
}

/**
 * 读取文件或目录基础信息。
 */
export async function getFileInfo(path) {
  if (isSafUri(path)) {
    const info = await safStatUri(path);
    if (!info) throw new Error('Stat failed');
    return info;
  }
  return invoke('get_file_info', { path });
}

/**
 * 列出目录内容。
 */
export async function getDirectoryContents(dirPath) {
  if (isSafUri(dirPath)) {
    return safListFolder(dirPath);
  }
  return invoke('get_directory_contents', { dirPath });
}

/**
 * 重命名文件；对 SAF 仅支持同目录改名，不支持跨目录移动。
 */
export async function renameFile(oldPath, newPath) {
  if (isSafUri(oldPath)) {
    // `newPath` 可能是同级子 URI，也可能只是新文件名；SAF 只支持原地改名，
    // 不支持像本地文件系统那样跨目录 move。
    try {
      // 若调用方传入的是完整路径，只提取最终展示名交给 SAF。
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

/**
 * 删除文件或 URI。
 */
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

/**
 * 启动文件变更监听。
 */
export async function startFileWatching(filePath) {
  // SAF 文档没有可直接接入 inotify 的真实路径；若改用轮询 `statUri` 成本较高，
  // 且 Android 上文件在编辑器外部被同时修改的场景较少，因此直接跳过监听。
  if (isSafUri(filePath)) return false;
  return invoke('start_file_watching', { filePath });
}

/**
 * 停止文件变更监听。
 */
export async function stopFileWatching(filePath) {
  if (isSafUri(filePath)) return false;
  return invoke('stop_file_watching', { filePath });
}

/**
 * 调用原生侧执行指定文件。
 *
 * @param {string} filePath 目标文件路径
 * @returns {Promise<unknown>} 原生命令返回结果
 */
export async function executeFile(filePath) {
  return invoke('execute_file', { filePath });
}

/**
 * 调用原生侧运行一段临时代码片段。
 *
 * @param {string} code 待执行的代码内容
 * @param {string} language 代码所属语言
 * @returns {Promise<unknown>} 原生命令返回结果
 */
export async function runCodeSnippet(code, language) {
  return invoke('run_code_snippet', { code, language });
}

/**
 * 在目录内搜索文件。
 *
 * SAF 场景下降级为当前层级的名称匹配，以避免深层遍历带来的性能问题。
 */
export async function searchFiles(dirPath, query, searchContent = false, maxResults = 100) {
  if (isSafUri(dirPath)) {
    // SAF 树遍历远慢于 `std::fs`，每深入一层都意味着新的 ContentResolver 查询；
    // 因此这里只保留“当前目录单层名称搜索”，保证搜索面板仍可用于快速定位文件。
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

/**
 * 在系统文件管理器中显示目标路径。
 */
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

/**
 * 在系统默认浏览器中打开外部链接。
 *
 * @param {string} url 需要打开的 http(s) 或 mailto 链接
 * @returns {Promise<void>} 打开完成的 Promise
 */
export async function openExternal(url) {
  return invoke('open_external', { url });
}

/**
 * 请求原生侧显示主窗口。
 *
 * @returns {Promise<unknown>} 原生命令返回结果
 */
export async function showMainWindow() {
  return invoke('show_main_window');
}

/**
 * 获取应用使用的文档目录。
 *
 * @returns {Promise<string>} 文档目录路径
 */
export async function getAppDocumentsDir() {
  return invoke('get_app_documents_dir');
}

/**
 * 获取应用启动时携带的命令行参数。
 *
 * @returns {Promise<unknown>} 命令行参数列表
 */
export async function getCliArgs() {
  return invoke('get_cli_args');
}

/**
 * 订阅原生侧发出的文件变更事件。
 */
export function onFileChanged(callback) {
  return listen('file-changed', (event) => callback(event.payload));
}
