import { invoke } from '@tauri-apps/api/core';

const EXTERNAL_SRC_RE = /^(?:https?:|data:|blob:|tauri:|asset:|content:|#)/i;

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

function isExternalSrc(src) {
  return !src || EXTERNAL_SRC_RE.test(src);
}

function isAbsolutePath(src) {
  return /^[A-Z]:[\\/]/i.test(src) || src.startsWith('/');
}

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

function dirname(path) {
  if (!path || typeof path !== 'string') return '';
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : '';
}

function joinPath(base, child) {
  if (!base) return child;
  const sep = base.includes('\\') ? '\\' : '/';
  return normalizeLocalPath(`${base.replace(/[\\/]+$/, '')}${sep}${child.replace(/^[\\/]+/, '')}`, sep);
}

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

function mimeFromPath(path) {
  const clean = (path || '').split(/[?#]/)[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export function resolveMarkdownAssetPath(src, documentPath) {
  const normalizedSrc = fileUrlToPath(src);
  if (!normalizedSrc || isExternalSrc(normalizedSrc) || isAbsolutePath(normalizedSrc)) return normalizedSrc;
  if (!documentPath || documentPath.startsWith('content://') || documentPath.startsWith('cloud://')) return src;
  return joinPath(dirname(documentPath), decodeURI(normalizedSrc));
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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

export function hydrateMarkdownImages(container, documentPath) {
  if (!container) return () => {};
  const objectUrls = [];
  let cancelled = false;

  container.querySelectorAll('img[src]').forEach((img) => {
    const currentSrc = img.getAttribute('src');
    const rawSrc = img.dataset.mdeOriginalSrc || currentSrc;
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
