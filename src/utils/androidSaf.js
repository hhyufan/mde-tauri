/**
 * Android SAF（Storage Access Framework）桥接模块。
 *
 * Kotlin 侧（`SafBridge` + `MainActivity`）通过 `window.AndroidSaf`
 * 暴露同步 JavaScript 接口。文件/目录选择器本质上是异步的，因为它会拉起外部 Activity，
 * 所以原生桥先返回一个数字回调 id，稍后再在主线程调用
 * `window.__androidSafResolve(id, uri)` 回传结果。
 *
 * 本模块负责把同步桥与延迟回调统一包装为 Promise 风格 API，并补齐
 * SAF URI 判断、目录读取、文本编解码、文件写入和展示名称解析等辅助能力。
 * 在非 Android 环境下，这些能力会退化为无操作或不可用状态；调用方应通过
 * `isAndroidSafAvailable()` 或更上层封装统一判断，而不是自行分支运行时环境。
 */

const SAF_SCHEME = 'content://';

// 按 callbackId 暂存尚未完成的选择器 Promise。
// 挂在 `window` 上是为了避免开发态热更新把进行中的请求直接丢失。
const pending =
  (typeof window !== 'undefined' && window.__androidSafPending) ||
  new Map();
if (typeof window !== 'undefined') {
  window.__androidSafPending = pending;
  if (!window.__androidSafResolve) {
    window.__androidSafResolve = (id, uri) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(uri || null);
    };
  }
}

/**
 * 读取原生注入的 Android SAF 桥对象。
 *
 * @returns {object | null} 原生注入的桥对象；当前环境不可用时返回 `null`。
 */
function getBridge() {
  if (typeof window === 'undefined') return null;
  return window.AndroidSaf || null;
}

/**
 * 判断当前运行环境是否已注入 Android SAF 原生桥。
 *
 * @returns {boolean} 可用时返回 `true`。
 */
export function isAndroidSafAvailable() {
  return !!getBridge();
}

/**
 * 判断给定值是否为 SAF `content://` URI。
 *
 * @param {unknown} value 待检测的值。
 * @returns {boolean} 命中 SAF URI 时返回 `true`。
 */
export function isSafUri(value) {
  return typeof value === 'string' && value.startsWith(SAF_SCHEME);
}

/**
 * 等待原生异步回调完成，并将 callback id 转成 Promise。
 *
 * @param {number} id 原生桥返回的回调标识。
 * @returns {Promise<string | null>} 选择器最终返回的 URI。
 */
function awaitCallback(id) {
  return new Promise((resolve, reject) => {
    if (!id || id <= 0) {
      reject(new Error('Invalid SAF callback id'));
      return;
    }
    pending.set(id, { resolve, reject });
  });
}

// ---------------------------------------------------------------------
// 选择器
// ---------------------------------------------------------------------

/**
 * 打开目录选择器，并返回用户选中的 tree URI。
 *
 * @param {string | null} [initialUri=null] 可选的初始目录 URI。
 * @returns {Promise<string | null>} 选中的目录 URI；用户取消时为 `null`。
 */
export async function pickFolder(initialUri = null) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const id = b.pickFolder(initialUri);
  return awaitCallback(id);
}

/**
 * 打开文件选择器，并返回用户选中的文档 URI。
 *
 * @param {string[]} [mimeTypes] 允许选择的 MIME 类型列表，默认值为任意类型。
 * @returns {Promise<string | null>} 选中的文件 URI；用户取消时为 `null`。
 */
export async function pickFile(mimeTypes = ['*/*']) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const id = b.pickFile(JSON.stringify(mimeTypes));
  return awaitCallback(id);
}

/**
 * 打开“另存为”选择器，并返回新建文档的 URI。
 *
 * @param {string} [suggestedName='untitled.md'] 建议文件名。
 * @param {string} [mimeType='text/markdown'] 新文件的 MIME 类型。
 * @returns {Promise<string | null>} 新文件 URI；用户取消时为 `null`。
 */
export async function pickSaveFile(suggestedName = 'untitled.md', mimeType = 'text/markdown') {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const id = b.pickSaveFile(suggestedName, mimeType);
  return awaitCallback(id);
}

// ---------------------------------------------------------------------
// 已持久化授权
// ---------------------------------------------------------------------

/**
 * 列出当前应用已持久化授权的 URI。
 *
 * @returns {string[]} 已持久化的 URI 列表；解析失败时返回空数组。
 */
export function listPersistedUris() {
  const b = getBridge();
  if (!b) return [];
  try {
    return JSON.parse(b.listPersistedUris() || '[]');
  } catch (_) {
    return [];
  }
}

/**
 * 释放某个已持久化的 URI 授权。
 *
 * @param {string} uri 待释放的 URI。
 * @returns {boolean} 释放成功时返回 `true`。
 */
export function releaseUri(uri) {
  const b = getBridge();
  if (!b) return false;
  return !!b.releaseUri(uri);
}

// ---------------------------------------------------------------------
// 目录读取与状态查询
// ---------------------------------------------------------------------

/**
 * 解析原生桥返回的 JSON 字符串。
 *
 * @param {string} str 原生桥返回的 JSON 文本。
 * @returns {any | null} 解析后的值；格式不合法时返回 `null`。
 */
function parseJson(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

/**
 * 将原生桥返回的标准错误对象转换为带错误码的异常。
 *
 * @param {any} payload 原生桥返回的对象。
 * @throws {Error} 当 `payload.ok === false` 时抛出异常，并附加 `code` 字段。
 */
function throwIfError(payload) {
  if (payload && typeof payload === 'object' && payload.ok === false) {
    const err = new Error(payload.message || 'SAF call failed');
    err.code = payload.code;
    throw err;
  }
}

/**
 * 读取 SAF 目录内容。
 *
 * @param {string} treeUri 目录对应的 tree URI。
 * @returns {Promise<any[]>} 目录项数组。
 */
export async function listFolder(treeUri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const raw = b.listFolder(treeUri);
  const data = parseJson(raw);
  // 成功时返回 JSON 数组；失败时返回形如 { ok:false, message } 的对象。
  if (Array.isArray(data)) return data;
  throwIfError(data);
  return [];
}

/**
 * 查询 URI 对应文档或目录的元信息。
 *
 * @param {string} uri 待查询的 URI。
 * @returns {Promise<any>} 原生桥返回的状态对象。
 */
export async function statUri(uri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.statUri(uri));
  throwIfError(data);
  return data;
}

/**
 * 判断目录下是否已存在给定名称的直接子项。
 *
 * @param {string} treeUri 父目录 tree URI。
 * @param {string} name 子项名称。
 * @returns {boolean} 存在时返回 `true`。
 */
export function childExists(treeUri, name) {
  const b = getBridge();
  if (!b) return false;
  try {
    return !!b.childExists(treeUri, name);
  } catch (_) {
    return false;
  }
}

/**
 * 解析目录下某个直接子项的真实 URI。
 *
 * @param {string} treeUri 父目录 tree URI。
 * @param {string} name 子项名称。
 * @returns {string | null} 子项 URI；不存在或失败时返回 `null`。
 */
export function resolveChild(treeUri, name) {
  const b = getBridge();
  if (!b) return null;
  try {
    return b.resolveChild(treeUri, name);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------
// 文件读写
//
// Kotlin 侧通过原生桥传递的是原始字节的 base64 编码结果。
// 这里使用 TextDecoder 还原，确保 UTF-8 多字节内容（中文、emoji、BOM 等）
// 在读写往返时保持正确。
// 理论上桥层也可以直接传字符串，但 JNI 的 MUTF-8 转换会破坏增补平面字符，
// 使用 base64 可以完全绕开这个问题。
// ---------------------------------------------------------------------

/**
 * 将 base64 字符串解码为字节数组。
 *
 * @param {string} b64 原生桥返回的 base64 文本。
 * @returns {Uint8Array} 解码后的字节数组。
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 将字节数组编码为 base64 文本。
 *
 * @param {Uint8Array} bytes 待编码的字节数组。
 * @returns {string} 编码后的 base64 字符串。
 */
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk)
    );
  }
  return btoa(binary);
}

/**
 * 根据字节头推断文本编码。
 *
 * 当前桥接层只显式区分 UTF-8 与带 BOM 的 UTF-8，返回值保留为统一的
 * 大写编码名，便于与上层编辑器元信息保持一致。
 *
 * @param {Uint8Array} bytes 文件原始字节。
 * @returns {string} 推断出的编码名称。
 */
function detectEncodingFromBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'UTF-8';
  }
  return 'UTF-8';
}

/**
 * 统计文本内容所使用的换行风格。
 *
 * @param {string} content 文本内容。
 * @returns {'CRLF' | 'CR' | 'LF'} 推断出的换行类型。
 */
function detectLineEnding(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/\n/g) || []).length - crlf;
  const cr = (content.match(/\r/g) || []).length - crlf;
  if (crlf > 0 && crlf >= lf && crlf >= cr) return 'CRLF';
  if (cr > 0 && cr >= lf) return 'CR';
  return 'LF';
}

/**
 * 以文本形式读取 SAF 文件，并返回内容与编码元信息。
 *
 * @param {string} uri 待读取文件的 URI。
 * @returns {Promise<{content: string, encoding: string, lineEnding: 'CRLF' | 'CR' | 'LF', size: number}>} 文件文本及元信息。
 */
export async function readFileText(uri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.readFile(uri));
  if (!data || data.ok === false) {
    throwIfError(data);
    throw new Error('Failed to read SAF file');
  }
  const bytes = base64ToBytes(data.content_base64 || '');
  const decoder = new TextDecoder('utf-8');
  const content = decoder.decode(bytes);
  // 去掉 UTF-8 BOM，避免它被再次带回编辑器缓冲区。
  const stripped = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return {
    content: stripped,
    encoding: detectEncodingFromBytes(bytes),
    lineEnding: detectLineEnding(stripped),
    size: data.size,
  };
}

/**
 * 以 UTF-8 文本形式写入 SAF 文件。
 *
 * @param {string} uri 目标文件 URI。
 * @param {string} content 待写入的文本内容。
 * @returns {Promise<{size: number}>} 写入后的文件大小信息。
 */
export async function writeFileText(uri, content) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content ?? '');
  const data = parseJson(b.writeFile(uri, bytesToBase64(bytes)));
  if (!data || data.ok === false) {
    throwIfError(data);
    throw new Error('Failed to write SAF file');
  }
  return { size: data.size };
}

// ---------------------------------------------------------------------
// 修改操作：创建 / 删除 / 重命名
// ---------------------------------------------------------------------

/**
 * 在目标目录下创建一个新文件。
 *
 * @param {string} treeUri 父目录 tree URI。
 * @param {string} displayName 新文件显示名。
 * @param {string | null} [mimeType=null] 新文件 MIME 类型。
 * @returns {Promise<string | null>} 新文件 URI。
 */
export async function createFileUnder(treeUri, displayName, mimeType = null) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.createFile(treeUri, displayName, mimeType));
  throwIfError(data);
  return data?.uri || null;
}

/**
 * 在目标目录下创建一个子目录。
 *
 * @param {string} treeUri 父目录 tree URI。
 * @param {string} displayName 子目录显示名。
 * @returns {Promise<string | null>} 新目录 URI。
 */
export async function createSubdirectory(treeUri, displayName) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.createSubdir(treeUri, displayName));
  throwIfError(data);
  return data?.uri || null;
}

/**
 * 删除给定 URI 对应的文档或目录。
 *
 * @param {string} uri 目标 URI。
 * @returns {Promise<boolean>} 删除成功时返回 `true`。
 */
export async function deleteUri(uri) {
  const b = getBridge();
  if (!b) return false;
  return !!b.deleteUri(uri);
}

/**
 * 重命名给定 URI 对应的文档或目录。
 *
 * @param {string} uri 目标 URI。
 * @param {string} newName 新名称。
 * @returns {Promise<string | null>} 重命名后的 URI。
 */
export async function renameUriTo(uri, newName) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.renameUri(uri, newName));
  throwIfError(data);
  return data?.uri || null;
}

// ---------------------------------------------------------------------
// 在系统文件管理器中打开
// ---------------------------------------------------------------------

/**
 * 请求系统文件管理器定位并打开指定 URI。
 *
 * @param {string} uri 目标 URI。
 * @returns {Promise<boolean>} 成功拉起系统文件管理器时返回 `true`。
 */
export async function openInFileManager(uri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  return !!b.openInFileManager(uri);
}

// ---------------------------------------------------------------------
// 从 tree URI 中提取展示名称（用于面包屑与标题）
// ---------------------------------------------------------------------

/**
 * 从 SAF tree/document URI 中提取可展示名称。
 *
 * @param {string} uri 原始 SAF URI。
 * @returns {string} 适合展示在标题、面包屑中的名称。
 */
export function safDisplayName(uri) {
  if (!isSafUri(uri)) return uri;
  try {
    const decoded = decodeURIComponent(uri);
    // Tree URI 形如：
    //   content://com.android.externalstorage.documents/tree/primary%3ADocuments
    //   content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments
    // 可展示名称通常位于最后一个 `:` 之后。
    const treeIdx = decoded.indexOf('/tree/');
    const subject = treeIdx >= 0 ? decoded.slice(treeIdx + 6) : decoded;
    // 如果是子文档 URI，则先取出 document id 对应片段。
    const docIdx = subject.indexOf('/document/');
    const tail = docIdx >= 0 ? subject.slice(docIdx + 10) : subject;
    const colon = tail.lastIndexOf(':');
    const name = colon >= 0 ? tail.slice(colon + 1) : tail;
    return name || tail || uri;
  } catch (_) {
    return uri;
  }
}
