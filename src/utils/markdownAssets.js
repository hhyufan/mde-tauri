/**
 * Markdown ???????
 *
 * ???????????????????????? object URL ?????
 */
import { invoke } from '@tauri-apps/api/core';

const EXTERNAL_SRC_RE = /^(?:https?:|data:|blob:|tauri:|asset:|content:|#)/i;
const EXTERNAL_LINK_RE = /^(?:https?:|mailto:|tel:|sms:|data:|blob:|javascript:|tauri:|asset:)/i;
const LINE_HINT_RE = /(?:^|[\s([{\u3000])L\s*(\d+)(?:\s*[~\-]\s*(\d+))?/i;

const MIME_BY_EXT = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/**
 * Markdown 资源解析工具。
 *
 * 把 Markdown 中的相对图片路径解析成可在 WebView 中访问的真实资源地址，
 * 并在需要时通过 Tauri 命令读取二进制内容、生成临时 object URL。
 */
function isExternalSrc(src) {
  return !src || EXTERNAL_SRC_RE.test(src);
}

/**
 * 判断是否已经是可直接访问的本地绝对路径。
 */
function isAbsolutePath(src) {
  return /^[A-Z]:[\\/]/i.test(src) || src.startsWith('/');
}

/**
 * 把 `file://` URL 还原成平台本地路径，便于后续统一拼接。
 */
function fileUrlToPath(src) {
  if (!/^file:/i.test(src || '')) return src;
  try {
    const url = new URL(src);
    const pathname = decodeURIComponent(url.pathname || '');
    if (/^\/[A-Z]:\//i.test(pathname)) return pathname.slice(1).replace(/\//g, '\\');
    return pathname;
  } catch (_) {
    return src.replace(/^file:\/\//i, '');
  }
}

/**
 * 取出路径的目录部分。
 */
function dirname(path) {
  if (!path || typeof path !== 'string') return '';
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : '';
}

/**
 * 以平台分隔符拼接本地路径并做归一化。
 */
function joinPath(base, child) {
  if (!base) return child;
  const sep = base.includes('\\') ? '\\' : '/';
  return normalizeLocalPath(`${base.replace(/[\\/]+$/, '')}${sep}${child.replace(/^[\\/]+/, '')}`, sep);
}

/**
 * 规整本地路径中的 `.`、`..` 与多余分隔符。
 */
function normalizeLocalPath(path, sep = path.includes('\\') ? '\\' : '/') {
  const drive = /^[A-Z]:/i.exec(path)?.[0] || '';
  const absolute = path.startsWith('/') || !!drive;
  const rest = drive ? path.slice(drive.length) : path;
  const parts = rest.split(/[\\/]+/);
  const out = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push(part);
      continue;
    }
    out.push(part);
  }

  if (drive) return `${drive}${sep}${out.join(sep)}`;
  return `${absolute ? sep : ''}${out.join(sep)}`;
}

/**
 * 根据文件扩展名推断图片 MIME。
 */
function mimeFromPath(path) {
  const clean = (path || '').split(/[?#]/)[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * 结合当前文档路径解析 Markdown 内联资源地址。
 *
 * 对 http/data/blob/content/cloud 等外部资源保持原样；仅对本地相对路径
 * 做归一化拼接，避免预览层误改外链语义。
 */
export function resolveMarkdownAssetPath(src, documentPath) {
  const normalizedSrc = fileUrlToPath(src);
  if (!normalizedSrc || isExternalSrc(normalizedSrc) || isAbsolutePath(normalizedSrc)) return normalizedSrc;
  if (!documentPath || documentPath.startsWith('content://') || documentPath.startsWith('cloud://')) return src;
  return joinPath(dirname(documentPath), decodeURI(normalizedSrc));
}

/**
 * 结合当前文档路径解析 Markdown 链接目标。
 *
 * 返回值会明确区分“应继续按外链处理”还是“可在应用内按本地文件打开”。
 * 其中相对本地路径会按当前文档所在目录归一化，便于预览层直接复用
 * `openFileFromPath()` 打开到编辑器标签。
 */
export function resolveMarkdownLinkPath(href, documentPath) {
  const normalizedHref = fileUrlToPath((href || '').trim());
  if (!normalizedHref) {
    return { path: '', internal: false, hash: '' };
  }
  if (normalizedHref.startsWith('#')) {
    return { path: '', internal: false, hash: normalizedHref.slice(1) };
  }
  if (EXTERNAL_LINK_RE.test(normalizedHref)) {
    return { path: normalizedHref, internal: false, hash: '' };
  }

  const [pathWithQuery = '', hash = ''] = normalizedHref.split('#', 2);
  const [pathPart = ''] = pathWithQuery.split('?', 1);
  const decodedPath = decodeURI(pathPart);
  if (!decodedPath) {
    return { path: '', internal: false, hash };
  }
  if (decodedPath.startsWith('content://') || decodedPath.startsWith('cloud://') || isAbsolutePath(decodedPath)) {
    return { path: decodedPath, internal: true, hash };
  }
  if (!documentPath || documentPath.startsWith('content://') || documentPath.startsWith('cloud://')) {
    return { path: normalizedHref, internal: false, hash };
  }
  return {
    path: joinPath(dirname(documentPath), decodedPath),
    internal: true,
    hash,
  };
}

/**
 * 从链接文案、图片 alt 或其他辅助文本中提取行号提示。
 *
 * 支持 `L12`、`L12-20`、`L12~20` 等形式；当前跳转逻辑会优先使用起始行。
 */
export function parseMarkdownLineHint(value) {
  const match = String(value || '').match(LINE_HINT_RE);
  if (!match) return null;
  const line = Number(match[1] || 0);
  const endLine = Number(match[2] || 0);
  if (!Number.isFinite(line) || line <= 0) return null;
  return {
    line,
    endLine: Number.isFinite(endLine) && endLine > 0 ? endLine : line,
  };
}

/**
 * 把 base64 字符串转换成可生成 Blob 的二进制数组。
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
 * 加载 Markdown 图片真实显示地址。
 *
 * 本地资源会被读取成 Blob 并生成 object URL；外部资源则直接原样透传。
 */
export async function loadMarkdownImageSrc(src, documentPath) {
  const target = resolveMarkdownAssetPath(src, documentPath);
  if (!target || isExternalSrc(target)) return { src: target, objectUrl: null };

  try {
    const result = await invoke('read_binary_file', { path: target });
    const bytes = base64ToBytes(result.content_base64 || '');
    const blob = new Blob([bytes], { type: result.mime_type || mimeFromPath(target) });
    const objectUrl = URL.createObjectURL(blob);
    return { src: objectUrl, objectUrl };
  } catch (_) {
    return { src: target, objectUrl: null };
  }
}

/**
 * 扫描容器内图片并异步水合真实可显示地址。
 *
 * 通过 `data-mde-*` 属性记录原始 src 与已生成的 object URL，既能避免重复
 * 解析，也能在组件卸载时统一释放浏览器资源。
 */
export function hydrateMarkdownImages(container, documentPath) {
  if (!container) return () => {};
  const objectUrls = [];
  let cancelled = false;

  container.querySelectorAll('img[src]').forEach((img) => {
    const currentSrc = img.getAttribute('src');
    const rawSrc = img.dataset.mdeOriginalSrc || currentSrc;
    // 使用原始 src 作为去重键，避免同一张图反复创建 object URL。
    if (!rawSrc || img.dataset.mdeResolvedSrc === rawSrc) return;
    img.dataset.mdeOriginalSrc = rawSrc;
    img.dataset.mdeResolvedSrc = rawSrc;

    loadMarkdownImageSrc(rawSrc, documentPath).then(({ src, objectUrl }) => {
      if (cancelled || !src) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (img.dataset.mdeObjectUrl) URL.revokeObjectURL(img.dataset.mdeObjectUrl);
      if (objectUrl) objectUrls.push(objectUrl);
      img.src = src;
      if (objectUrl) img.dataset.mdeObjectUrl = objectUrl;
    });
  });

  return () => {
    cancelled = true;
    objectUrls.forEach((url) => {
      URL.revokeObjectURL(url);
      container.querySelectorAll(`img[data-mde-object-url="${url}"]`).forEach((img) => {
        delete img.dataset.mdeObjectUrl;
      });
    });
  };
}
