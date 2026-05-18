// Android SAF (Storage Access Framework) bridge.
//
// The Kotlin side (`SafBridge` + `MainActivity`) exposes a synchronous
// JavaScript interface as `window.AndroidSaf`. Pickers are inherently
// asynchronous (they launch a foreign activity), so the bridge returns a
// numeric callback id and later invokes `window.__androidSafResolve(id, uri)`
// on the main thread. This module turns both flavours into ordinary
// Promise-returning functions so call sites can `await` them.
//
// Everything in this file is a *no-op when not on Android* — callers must
// guard with `isAndroidSafAvailable()` (or use the higher-level helpers in
// `useFileManager`) instead of branching on `navigator.userAgent`.

const SAF_SCHEME = 'content://';

// Pending picker promises keyed by callbackId. Kept on `window` so a hot
// reload doesn't orphan in-flight requests during dev.
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

function getBridge() {
  if (typeof window === 'undefined') return null;
  return window.AndroidSaf || null;
}

export function isAndroidSafAvailable() {
  return !!getBridge();
}

export function isSafUri(value) {
  return typeof value === 'string' && value.startsWith(SAF_SCHEME);
}

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
// Pickers
// ---------------------------------------------------------------------

export async function pickFolder(initialUri = null) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const id = b.pickFolder(initialUri);
  return awaitCallback(id);
}

export async function pickFile(mimeTypes = ['*/*']) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const id = b.pickFile(JSON.stringify(mimeTypes));
  return awaitCallback(id);
}

export async function pickSaveFile(suggestedName = 'untitled.md', mimeType = 'text/markdown') {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const id = b.pickSaveFile(suggestedName, mimeType);
  return awaitCallback(id);
}

// ---------------------------------------------------------------------
// Persisted authorizations
// ---------------------------------------------------------------------

export function listPersistedUris() {
  const b = getBridge();
  if (!b) return [];
  try {
    return JSON.parse(b.listPersistedUris() || '[]');
  } catch (_) {
    return [];
  }
}

export function releaseUri(uri) {
  const b = getBridge();
  if (!b) return false;
  return !!b.releaseUri(uri);
}

// ---------------------------------------------------------------------
// Directory listing / stat
// ---------------------------------------------------------------------

function parseJson(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

function throwIfError(payload) {
  if (payload && typeof payload === 'object' && payload.ok === false) {
    const err = new Error(payload.message || 'SAF call failed');
    err.code = payload.code;
    throw err;
  }
}

export async function listFolder(treeUri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const raw = b.listFolder(treeUri);
  const data = parseJson(raw);
  // Successful path returns a JSON array; failure returns { ok:false, message }
  if (Array.isArray(data)) return data;
  throwIfError(data);
  return [];
}

export async function statUri(uri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.statUri(uri));
  throwIfError(data);
  return data;
}

export function childExists(treeUri, name) {
  const b = getBridge();
  if (!b) return false;
  try {
    return !!b.childExists(treeUri, name);
  } catch (_) {
    return false;
  }
}

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
// File IO
//
// The Kotlin side reads/writes raw bytes and base64-encodes them in the
// JS bridge channel; we decode with TextDecoder so multi-byte UTF-8
// (CJK, emoji, BOM, etc.) round-trips correctly. The bridge could in
// theory pass strings directly, but JNI's MUTF-8 conversion mangles
// supplementary-plane characters — base64 sidesteps that entirely.
// ---------------------------------------------------------------------

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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

function detectEncodingFromBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'UTF-8';
  }
  return 'UTF-8';
}

function detectLineEnding(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/\n/g) || []).length - crlf;
  const cr = (content.match(/\r/g) || []).length - crlf;
  if (crlf > 0 && crlf >= lf && crlf >= cr) return 'CRLF';
  if (cr > 0 && cr >= lf) return 'CR';
  return 'LF';
}

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
  // Strip UTF-8 BOM (the editor doesn't want it round-tripping into the buffer)
  const stripped = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return {
    content: stripped,
    encoding: detectEncodingFromBytes(bytes),
    lineEnding: detectLineEnding(stripped),
    size: data.size,
  };
}

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
// Mutations: create / delete / rename
// ---------------------------------------------------------------------

export async function createFileUnder(treeUri, displayName, mimeType = null) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.createFile(treeUri, displayName, mimeType));
  throwIfError(data);
  return data?.uri || null;
}

export async function createSubdirectory(treeUri, displayName) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.createSubdir(treeUri, displayName));
  throwIfError(data);
  return data?.uri || null;
}

export async function deleteUri(uri) {
  const b = getBridge();
  if (!b) return false;
  return !!b.deleteUri(uri);
}

export async function renameUriTo(uri, newName) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  const data = parseJson(b.renameUri(uri, newName));
  throwIfError(data);
  return data?.uri || null;
}

// ---------------------------------------------------------------------
// Open in system file manager
// ---------------------------------------------------------------------

export async function openInFileManager(uri) {
  const b = getBridge();
  if (!b) throw new Error('AndroidSaf bridge unavailable');
  return !!b.openInFileManager(uri);
}

// ---------------------------------------------------------------------
// Display-name helper for tree URIs (used in the breadcrumb/title)
// ---------------------------------------------------------------------

export function safDisplayName(uri) {
  if (!isSafUri(uri)) return uri;
  try {
    const decoded = decodeURIComponent(uri);
    // Tree URIs look like:
    //   content://com.android.externalstorage.documents/tree/primary%3ADocuments
    //   content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments
    // The displayable part is everything after the final ':'.
    const treeIdx = decoded.indexOf('/tree/');
    const subject = treeIdx >= 0 ? decoded.slice(treeIdx + 6) : decoded;
    // For a child document URI, take the doc id portion.
    const docIdx = subject.indexOf('/document/');
    const tail = docIdx >= 0 ? subject.slice(docIdx + 10) : subject;
    const colon = tail.lastIndexOf(':');
    const name = colon >= 0 ? tail.slice(colon + 1) : tail;
    return name || tail || uri;
  } catch (_) {
    return uri;
  }
}
