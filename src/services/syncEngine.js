import pako from 'pako';
import apiClient from './apiClient';
import { readFileContent, saveFile, checkFileExists } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useFileIdStore from '@store/useFileIdStore';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useNotificationStore from '@store/useNotificationStore';
import useAuthStore from '@store/useAuthStore';
import useDeviceStore from '@store/useDeviceStore';
import useExternalDocsStore from '@store/useExternalDocsStore';

/**
 * Threshold above which we gzip the file body before sending. Below this
 * the overhead of base64 + gzip header is not worth it.
 */
const COMPRESS_THRESHOLD_BYTES = 16 * 1024;

/**
 * Hard ceiling for a single sync request payload, in bytes (compressed).
 *
 * Vercel caps Serverless Function request bodies at ~4.5MB on Hobby and
 * ~5MB on Pro. We stay well below that because the JSON envelope, base64
 * inflation (~33%), and headers also count. Files whose compressed body
 * exceeds this are skipped (with a friendly notification) instead of
 * crashing the sync.
 */
const MAX_REQUEST_BYTES = 3.5 * 1024 * 1024;

/**
 * Virtual path prefix used in `useFileStore.bookmarkedPaths` for cloud
 * bookmarks that have no local file on this device yet. The actual content
 * for such a bookmark lives in `useExternalDocsStore` keyed by fileId.
 */
export const CLOUD_PATH_PREFIX = 'cloud://';

export function makeCloudPath(fileId) {
  return `${CLOUD_PATH_PREFIX}${fileId}`;
}

export function isCloudPath(p) {
  return typeof p === 'string' && p.startsWith(CLOUD_PATH_PREFIX);
}

export function fileIdFromCloudPath(p) {
  return isCloudPath(p) ? p.slice(CLOUD_PATH_PREFIX.length) : null;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', textEncoder.encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk),
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function basename(p) {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function extOf(name) {
  if (!name) return '';
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/**
 * Encode raw text into the wire format the server expects.
 * Returns { content, compressed, size, checksum, compressedBytes }.
 */
async function encodeBody(rawText) {
  const rawBytes = textEncoder.encode(rawText);
  const checksum = await sha256(rawText);
  if (rawBytes.byteLength < COMPRESS_THRESHOLD_BYTES) {
    return {
      content: rawText,
      compressed: false,
      size: rawBytes.byteLength,
      checksum,
      compressedBytes: rawBytes.byteLength,
    };
  }
  const gz = pako.gzip(rawBytes);
  const b64 = bytesToBase64(gz);
  return {
    content: b64,
    compressed: true,
    size: rawBytes.byteLength,
    checksum,
    compressedBytes: b64.length,
  };
}

function decodeBody(doc) {
  if (!doc.compressed) return doc.content || '';
  const bytes = base64ToBytes(doc.content || '');
  const inflated = pako.ungzip(bytes);
  return textDecoder.decode(inflated);
}

/**
 * Read on-disk content for every bookmarked file that actually exists on
 * this device. Cloud-only bookmarks (`cloud://...` virtual paths) are
 * skipped here — their content lives in `useExternalDocsStore` and is only
 * pushed back once the user picks a real local path via "Save As".
 */
async function collectBookmarkedFilesToSync() {
  const bookmarks = useFileStore.getState().bookmarkedPaths || [];
  const out = [];
  for (const path of bookmarks) {
    if (!path || isCloudPath(path)) continue;
    try {
      const exists = await checkFileExists(path);
      if (!exists) continue;
      const result = await readFileContent(path);
      // `readFileContent` returns either the raw string (legacy) or a
      // result object with { success, content, encoding }. Be defensive.
      let content = '';
      let encoding = 'UTF-8';
      if (typeof result === 'string') {
        content = result;
      } else if (result && typeof result === 'object') {
        if (result.success === false) continue;
        content = result.content || '';
        encoding = result.encoding || 'UTF-8';
      }
      out.push({ path, source: 'bookmark', content, encoding });
    } catch {
      // unreadable (deleted / permission denied) — skip silently
    }
  }
  return out;
}

class SyncEngine {
  constructor() {
    this.status = 'idle';
    this.listeners = new Set();
  }

  onStatusChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setStatus(s) {
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Push one file to the cloud. Used both directly (e.g. on save) and as
   * the per-file primitive of `fullSync`. The path is sent as both the
   * legacy `originalPath` (purely informational) and as `devicePath` keyed
   * under the current `deviceId`, so the server can remember where this
   * device keeps the file locally.
   *
   * Returns:
   *   { ok: true }                            on success / already in sync
   *   { ok: false, reason: 'too-large', ... } if compressed body exceeds limit
   *   { ok: false, reason: 'error', error }   on transport / server error
   */
  async pushSingle(filePath, content, encoding = 'UTF-8', source = 'manual') {
    if (!useAuthStore.getState().isLoggedIn || !filePath) {
      return { ok: false, reason: 'unauth' };
    }
    if (isCloudPath(filePath)) {
      // Should never happen — virtual paths must be resolved to a real
      // disk path (via Save As) before pushing.
      return { ok: false, reason: 'virtual-path' };
    }
    try {
      const body = await encodeBody(content || '');
      if (body.compressedBytes > MAX_REQUEST_BYTES) {
        return {
          ok: false,
          reason: 'too-large',
          size: body.size,
          compressed: body.compressedBytes,
        };
      }
      const fileId = useFileIdStore.getState().getOrCreate(filePath);
      const deviceId = useDeviceStore.getState().getId();
      await apiClient.post('/sync/file', {
        fileId,
        fileName: basename(filePath),
        originalPath: filePath,
        source,
        content: body.content,
        compressed: body.compressed,
        size: body.size,
        encoding,
        checksum: body.checksum,
        deviceId,
        devicePath: filePath,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', error: err };
    }
  }

  /**
   * Apply a pulled document to local state.
   *
   * If the server already remembers a local path for this device
   * (`doc.devicePaths[myDeviceId]`), we refresh that on-disk file and
   * keep the local fileId binding pointing at it.
   *
   * Otherwise the document is *external* on this device: we stash its
   * content in `useExternalDocsStore` so the user can open and edit it,
   * but we deliberately do NOT pick a fallback location on disk. The
   * first save will go through the normal "Save As" flow which then
   * registers the chosen path under our `deviceId` on the server.
   */
  async applyPulledDoc(doc) {
    const deviceId = useDeviceStore.getState().getId();
    const myPath = doc.devicePaths?.[deviceId];
    let decoded;
    try {
      decoded = decodeBody(doc);
    } catch (err) {
      // Bad payload — keep the metadata entry around so the user can
      // still see the file name in the cloud-bookmarks list, but we
      // can't honor an open request without content.
      // eslint-disable-next-line no-console
      console.warn('[sync] failed to decode pulled doc', doc.fileId, err);
      return { writtenPath: null, external: true, decodeFailed: true };
    }

    if (myPath) {
      try {
        const result = await saveFile(myPath, decoded, doc.encoding || 'UTF-8');
        if (result?.success !== false) {
          useFileIdStore.getState().bind(myPath, doc.fileId);
          // The doc is now bound locally — drop any stale external entry.
          useExternalDocsStore.getState().remove(doc.fileId);
          return { writtenPath: myPath, external: false };
        }
      } catch {
        // fallthrough to "external" handling below — disk is unavailable
        // or path is invalid on this device, treat as cloud-only for now.
      }
    }

    useExternalDocsStore.getState().put(doc.fileId, {
      name: doc.fileName || basename(doc.originalPath || '') || doc.fileId,
      ext: extOf(doc.fileName || doc.originalPath || ''),
      encoding: doc.encoding || 'UTF-8',
      lineEnding: doc.lineEnding || 'LF',
      originalPath: doc.originalPath || '',
      content: decoded,
      checksum: doc.checksum || '',
    });
    return { writtenPath: null, external: true };
  }

  /**
   * Ensure the external-docs cache has the *body* for `fileId`, fetching
   * it from the server if necessary. Used as a self-heal step when the
   * user clicks a `cloud://` bookmark whose content didn't make it into
   * the cache during fullSync (e.g. a transient pull failure).
   *
   * Returns the cached entry on success, or `null` on failure.
   */
  async ensureExternalDoc(fileId) {
    if (!fileId) return null;
    const cached = useExternalDocsStore.getState().get(fileId);
    if (cached && typeof cached.content === 'string') return cached;
    try {
      const { data: doc } = await apiClient.get(`/sync/file/${encodeURIComponent(fileId)}`);
      if (!doc) return null;
      await this.applyPulledDoc(doc);
      return useExternalDocsStore.getState().get(fileId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sync] ensureExternalDoc failed', fileId, err);
      return null;
    }
  }

  /**
   * Promote an "external" document to a real on-disk file: the user just
   * picked `localPath` via Save As. We bind the fileId locally, replace
   * the `cloud://<fileId>` virtual bookmark with the real path, drop the
   * external-docs entry, and push the file (which also registers the
   * device path on the server).
   */
  async claimExternalDoc(fileId, localPath, content, encoding = 'UTF-8') {
    if (!fileId || !localPath) return { ok: false };
    useFileIdStore.getState().bind(localPath, fileId);
    useExternalDocsStore.getState().remove(fileId);

    const fileStore = useFileStore.getState();
    const cloudPath = makeCloudPath(fileId);
    const next = (fileStore.bookmarkedPaths || []).map((p) =>
      p === cloudPath ? localPath : p,
    );
    if (!next.includes(localPath)) next.push(localPath);
    useFileStore.setState({ bookmarkedPaths: next });

    return this.pushSingle(localPath, content, encoding, 'bookmark');
  }

  async fullSync() {
    if (!useAuthStore.getState().isLoggedIn) return;
    if (this.status === 'syncing') return;

    this.setStatus('syncing');
    const notify = useNotificationStore.getState().notify;
    const skipped = [];

    try {
      const { data: manifest } = await apiClient.get('/sync/manifest');
      const remoteByFileId = new Map(manifest.map((m) => [m.fileId, m]));
      const deviceId = useDeviceStore.getState().getId();

      // ── Push: bookmarked files that exist locally on this device ──
      const local = await collectBookmarkedFilesToSync();
      for (const f of local) {
        const fileId = useFileIdStore.getState().getOrCreate(f.path);
        const remote = remoteByFileId.get(fileId);
        const checksum = await sha256(f.content || '');
        const remotePathOnThisDevice = remote?.devicePaths?.[deviceId];
        const sameContent = remote && remote.checksum === checksum;
        const samePath = remotePathOnThisDevice === f.path;
        if (sameContent && samePath) {
          remoteByFileId.delete(fileId);
          continue;
        }
        const result = await this.pushSingle(f.path, f.content, f.encoding, 'bookmark');
        if (!result.ok && result.reason === 'too-large') {
          skipped.push({ path: f.path, size: result.size });
        }
        remoteByFileId.delete(fileId);
      }

      // ── Pull: every remaining remote doc; the per-doc apply step decides
      // whether to write to disk (if this device has a registered path)
      // or stash it in the external-docs cache for the user to claim.
      //
      // We first seed display metadata (name/ext/originalPath) from the
      // lightweight manifest so the sidebar can render a meaningful row
      // immediately — even if the per-file body pull below fails, the
      // user at least sees the right file name and we self-heal on click
      // via `ensureExternalDoc`.
      for (const [fileId, meta] of remoteByFileId) {
        const remoteDevicePath = meta?.devicePaths?.[deviceId];
        if (remoteDevicePath) continue;
        if (useFileIdStore.getState().pathOf(fileId)) continue;
        const name = meta.fileName || basename(meta.originalPath || '') || fileId;
        useExternalDocsStore.getState().put(fileId, {
          name,
          ext: extOf(name),
          originalPath: meta.originalPath || '',
          checksum: meta.checksum || '',
        });
      }

      for (const [fileId] of remoteByFileId) {
        try {
          const { data: doc } = await apiClient.get(`/sync/file/${encodeURIComponent(fileId)}`);
          if (doc) await this.applyPulledDoc(doc);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[sync] per-file pull failed', fileId, err);
        }
      }

      // Garbage-collect external-docs entries the server no longer has.
      const liveIds = new Set(manifest.map((m) => m.fileId));
      const externalIds = useExternalDocsStore.getState().ids();
      for (const id of externalIds) {
        if (!liveIds.has(id)) useExternalDocsStore.getState().remove(id);
      }

      await this.syncConfig();

      if (skipped.length > 0) {
        const list = skipped
          .slice(0, 3)
          .map((s) => `${basename(s.path)} (${(s.size / 1024 / 1024).toFixed(1)} MB)`)
          .join(', ');
        notify(
          'warning',
          'Sync: some files skipped',
          `${skipped.length} file(s) exceeded the request size limit even after compression: ${list}${skipped.length > 3 ? '…' : ''}`,
        );
      }
      this.setStatus('synced');
    } catch (err) {
      this.setStatus('error');
      notify('error', 'Sync failed', String(err?.message || err));
    }
  }

  /**
   * Bidirectional config sync.
   *
   * The wire format for `recentFiles` / `bookmarks` is **fileId-based**, not
   * path-based, so the same logical entry can be reconstructed on a
   * different device whose absolute paths differ. The local UI lists are
   * rebuilt from fileIds: bookmarks bound on this device become real local
   * paths; bookmarks not bound here become `cloud://<fileId>` virtual
   * paths backed by `useExternalDocsStore`.
   *
   * Both sides are merged (union by fileId) so a fresh device cannot
   * accidentally wipe the cloud copy.
   */
  async syncConfig() {
    try {
      const fileIdStore = useFileIdStore.getState();
      const fileStore = useFileStore.getState();

      // 1. Local entries → wire format (fileId-keyed). Cloud-only
      //    bookmarks are already keyed by fileId via their virtual path;
      //    real bookmarks need a path→fileId lookup.
      const localBookmarkWire = (fileStore.bookmarkedPaths || [])
        .map((p) => {
          if (!p) return null;
          if (isCloudPath(p)) return { fileId: fileIdFromCloudPath(p) };
          const fileId = fileIdStore.idOf(p) || fileIdStore.getOrCreate(p);
          return fileId ? { fileId } : null;
        })
        .filter(Boolean);

      const localRecentWire = (fileStore.recentFiles || [])
        .map((r) => {
          if (!r?.path || isCloudPath(r.path)) return null;
          const fileId = fileIdStore.idOf(r.path) || fileIdStore.getOrCreate(r.path);
          if (!fileId) return null;
          return {
            fileId,
            name: r.name || basename(r.path),
            ext: r.ext || extOf(r.name || r.path),
          };
        })
        .filter(Boolean);

      // 2. Pull remote
      const { data: remoteConfig = {} } = await apiClient.get('/sync/config');
      const localConfig = useConfigStore.getState();
      const localTheme = useThemeStore.getState().theme;

      // 3. Merge by fileId. Local entries take priority for ordering;
      // remote-only entries are appended.
      const seenRecent = new Set();
      const mergedRecentWire = [];
      for (const r of localRecentWire) {
        if (seenRecent.has(r.fileId)) continue;
        seenRecent.add(r.fileId);
        mergedRecentWire.push(r);
      }
      for (const r of remoteConfig.recentFiles || []) {
        if (!r?.fileId || seenRecent.has(r.fileId)) continue;
        seenRecent.add(r.fileId);
        mergedRecentWire.push({
          fileId: r.fileId,
          name: r.name || '',
          ext: r.ext || '',
        });
      }
      const mergedRecentWireCapped = mergedRecentWire.slice(0, 100);

      const bookmarkIds = new Set();
      for (const b of localBookmarkWire) bookmarkIds.add(b.fileId);
      for (const b of remoteConfig.bookmarks || []) {
        if (b?.fileId) bookmarkIds.add(b.fileId);
      }
      const mergedBookmarkWire = [...bookmarkIds].map((fileId) => ({ fileId }));

      // 4. Push merged config back
      await apiClient.put('/sync/config', {
        theme: localTheme,
        language: localConfig.language,
        fontSize: localConfig.fontSize,
        tabSize: localConfig.tabSize,
        wordWrap: localConfig.wordWrap,
        lineNumbers: localConfig.lineNumbers,
        autoSave: localConfig.autoSave,
        workspacePath: localConfig.workspacePath,
        recentFiles: mergedRecentWireCapped,
        bookmarks: mergedBookmarkWire,
        editorState: {
          sidebarVisible: useEditorStore.getState().sidebarVisible,
          sidebarView: useEditorStore.getState().sidebarView,
        },
      });

      // 5. Apply remote → local
      if (remoteConfig.theme && remoteConfig.theme !== localTheme) {
        useThemeStore.getState().setTheme(remoteConfig.theme);
      }

      // Recent: only re-list entries we have a real local path for.
      const newLocalRecent = [];
      for (const r of mergedRecentWireCapped) {
        const path = useFileIdStore.getState().pathOf(r.fileId);
        if (!path) continue;
        newLocalRecent.push({
          name: r.name || basename(path),
          path,
          ext: r.ext || extOf(path),
        });
        if (newLocalRecent.length >= 20) break;
      }

      // Bookmarks: real path if bound on this device, else virtual cloud path.
      const newLocalBookmarks = [];
      for (const fileId of bookmarkIds) {
        const path = useFileIdStore.getState().pathOf(fileId);
        if (path) {
          newLocalBookmarks.push(path);
        } else {
          newLocalBookmarks.push(makeCloudPath(fileId));
        }
      }
      useFileStore.setState({
        recentFiles: newLocalRecent,
        bookmarkedPaths: newLocalBookmarks,
      });
    } catch {
      // config sync is best-effort
    }
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
