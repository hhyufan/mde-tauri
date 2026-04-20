import pako from 'pako';
import apiClient, { classifyApiError } from './apiClient';
import { saveFile } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import useFileIdStore from '@store/useFileIdStore';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useNotificationStore from '@store/useNotificationStore';
import useAuthStore from '@store/useAuthStore';
import useDeviceStore from '@store/useDeviceStore';
import useExternalDocsStore from '@store/useExternalDocsStore';
import useSyncStore, { SYNC_PROTOCOL_VERSION } from '@store/useSyncStore';
import { getLocalSettingsSnapshot, applySettingsSnapshot } from '@utils/settingsSync';

// 小体积内容直接明文上传，避免不必要的 gzip 开销。
const COMPRESS_THRESHOLD_BYTES = 16 * 1024;
// 预留服务端请求体上限安全余量（避免触发平台硬限制）。
const MAX_REQUEST_BYTES = 3.5 * 1024 * 1024;
const CONFIG_SYNC_DEBOUNCE_MS = 900;
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

function mutationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function buildConfigPayload() {
  return getLocalSettingsSnapshot();
}

function getLocalConflictContent(path, fileId) {
  const editor = useEditorStore.getState();
  const tab = editor.getTabByPath?.(path)
    || editor.tabs.find((item) => item.path === path || item.externalFileId === fileId);
  if (tab?.content) return tab.content;
  return useExternalDocsStore.getState().get(fileId)?.content || '';
}

class SyncEngine {
  constructor() {
    this.status = 'idle';
    this.listeners = new Set();
    this.retryTimer = null;
    this.syncing = false;
    this.configSyncTimer = null;
    this.suppressConfigAutoSync = false;
    this.setupConfigSubscriptions();
  }

  setupConfigSubscriptions() {
    useConfigStore.subscribe((state, prev) => {
      if ((state.configUpdatedAt || 0) !== (prev.configUpdatedAt || 0)) {
        this.scheduleConfigSync();
      }
    });
    useThemeStore.subscribe((state, prev) => {
      if ((state.themeUpdatedAt || 0) !== (prev.themeUpdatedAt || 0)) {
        this.scheduleConfigSync();
      }
    });
    useEditorStore.subscribe((state, prev) => {
      if ((state.uiStateUpdatedAt || 0) !== (prev.uiStateUpdatedAt || 0)) {
        this.scheduleConfigSync();
      }
    });
  }

  scheduleConfigSync() {
    if (this.suppressConfigAutoSync || this.syncing) return;
    if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) return;
    if (this.configSyncTimer) clearTimeout(this.configSyncTimer);
    this.configSyncTimer = setTimeout(() => {
      this.configSyncTimer = null;
      this.syncConfig().catch(() => {});
    }, CONFIG_SYNC_DEBOUNCE_MS);
  }

  getLocalConfigUpdatedAt() {
    return Number(buildConfigPayload().updatedAt || 0);
  }

  applyRemoteConfig(remoteConfig = {}) {
    this.suppressConfigAutoSync = true;
    try {
      applySettingsSnapshot(remoteConfig);
    } finally {
      this.suppressConfigAutoSync = false;
    }
  }

  onStatusChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setStatus(s) {
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  scheduleRetry() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const nextAt = useSyncStore.getState().getNextRetryAt();
    if (!nextAt) return;
    const delay = Math.max(0, nextAt - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (useAuthStore.getState().isLoggedIn) {
        this.fullSync();
      }
    }, delay);
  }

  shouldRetry(kind) {
    return ['offline', 'server_unreachable', 'server_error', 'error'].includes(kind);
  }

  async ensureLocalReset() {
    const syncStore = useSyncStore.getState();
    if (syncStore.isLocalResetDone()) return;
    useExternalDocsStore.getState().resetCurrentUser();
    useFileStore.getState().removeCloudBookmarks();
    useFileIdStore.getState().resetCurrentUser();
    syncStore.resetDocumentsAndQueue();
    syncStore.markLocalResetDone();
  }

  async ensureRemoteProtocol() {
    const { data: remoteConfig = {} } = await apiClient.get('/sync/config');
    if ((remoteConfig.protocolVersion || 1) >= SYNC_PROTOCOL_VERSION) {
      return remoteConfig;
    }
    try {
      await apiClient.post('/sync/reset');
    } catch (err) {
      if (err?.response?.status === 404) {
        const upgradeError = new Error('Sync server is outdated. Deploy the new server or update the server URL.');
        upgradeError.code = 'SYNC_SERVER_OUTDATED';
        throw upgradeError;
      }
      throw err;
    }
    useSyncStore.getState().resetDocumentsAndQueue();
    await apiClient.put('/sync/config', buildConfigPayload());
    return { protocolVersion: SYNC_PROTOCOL_VERSION };
  }

  registerLocalDocument(filePath, meta = {}) {
    if (!filePath || isCloudPath(filePath)) return null;
    const fileIdStore = useFileIdStore.getState();
    const existingFileId = fileIdStore.idOf(filePath);
    const isBookmarked = useFileStore.getState().isBookmarked(filePath);

    // 只有在以下两种情况时，才会创建（生成）一个新的 fileId
    let fileId = meta.fileId || existingFileId;
    if (!fileId && isBookmarked) {
      fileId = fileIdStore.getOrCreate(filePath);
    }

    if (!fileId) return null;

    fileIdStore.bind(filePath, fileId);
    useSyncStore.getState().bindLocalPath(fileId, filePath, {
      name: meta.name || basename(filePath),
      ext: meta.ext || extOf(meta.name || filePath),
      encoding: meta.encoding || 'UTF-8',
      lineEnding: meta.lineEnding || 'LF',
      source: meta.source || 'local',
      status: meta.status || 'idle',
      deleted: false,
    });
    return fileId;
  }

  async queueLocalUpsert(filePath, content, encoding = 'UTF-8', options = {}) {
    if (!filePath || isCloudPath(filePath)) {
      return { ok: false, reason: 'invalid-path' };
    }
    if (typeof content !== 'string') {
      console.warn('[sync] skipped upload because content is not a string', {
        filePath,
        source: options.source || 'local',
        contentType: typeof content,
      });
      return { ok: false, reason: 'missing-content' };
    }

    const existingFileId = useFileIdStore.getState().idOf(filePath);
    const isBookmarked = useFileStore.getState().isBookmarked(filePath);

    // 本地文件只有在“已收藏”或“已存在云端 fileId”时才进入云同步。
    if (!existingFileId && !isBookmarked) {
      return { ok: true, skipped: 'not-bookmarked-and-not-cloud' };
    }

    const fileId = this.registerLocalDocument(filePath, {
      name: options.name || basename(filePath),
      encoding,
      lineEnding: options.lineEnding || 'LF',
      source: options.source || 'local',
    });

    if (!fileId) {
      return { ok: true, skipped: 'not-bookmarked' };
    }

    if (!useConfigStore.getState().syncEnabled) {
      return { ok: true, fileId, skipped: 'sync-disabled' };
    }
    const body = await encodeBody(content);
    if (body.compressedBytes > MAX_REQUEST_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        size: body.size,
        compressed: body.compressedBytes,
      };
    }
    const doc = useSyncStore.getState().getDoc(fileId);
    useSyncStore.getState().upsertDoc(fileId, {
      name: options.name || doc?.name || basename(filePath),
      ext: doc?.ext || extOf(options.name || basename(filePath)),
      localPath: filePath,
      encoding,
      lineEnding: options.lineEnding || doc?.lineEnding || 'LF',
      checksum: body.checksum,
      deleted: false,
      status: 'pending_push',
      lastError: null,
    });
    // 同一文件只保留一条去重后的 upsert，后续编辑覆盖旧 payload，
    // 确保队列里始终是最新内容快照。
    useSyncStore.getState().enqueueMutation({
      fileId,
      type: 'upsert',
      baseRev: doc?.lastKnownServerRev || doc?.rev || 0,
      dedupeKey: 'upsert',
      payload: {
        fileName: options.name || basename(filePath),
        originalPath: filePath,
        source: options.source || 'local',
        content: body.content,
        rawContent: content,
        compressed: body.compressed,
        size: body.size,
        encoding,
        lineEnding: options.lineEnding || doc?.lineEnding || 'LF',
        checksum: body.checksum,
        deviceId: useDeviceStore.getState().getId(),
        devicePath: filePath,
      },
    });
    if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
      this.fullSync();
    }
    return { ok: true, fileId };
  }

  async queueExternalUpsert(fileId, content, encoding = 'UTF-8', options = {}) {
    if (!fileId) {
      return { ok: false, reason: 'invalid-fileId' };
    }
    if (typeof content !== 'string') {
      return { ok: false, reason: 'missing-content' };
    }

    const syncStore = useSyncStore.getState();
    const externalStore = useExternalDocsStore.getState();
    const doc = syncStore.getDoc(fileId);
    const externalDoc = externalStore.get(fileId);

    if (!useConfigStore.getState().syncEnabled) {
      return { ok: true, fileId, skipped: 'sync-disabled' };
    }

    const body = await encodeBody(content);
    if (body.compressedBytes > MAX_REQUEST_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        size: body.size,
        compressed: body.compressedBytes,
      };
    }

    const fileName = options.name || doc?.name || externalDoc?.name || fileId;
    const ext = doc?.ext || externalDoc?.ext || extOf(fileName);
    const lineEnding = options.lineEnding || doc?.lineEnding || externalDoc?.lineEnding || 'LF';
    const originalPath = externalDoc?.originalPath || doc?.localPath || '';

    syncStore.upsertDoc(fileId, {
      name: fileName,
      ext,
      localPath: '',
      encoding,
      lineEnding,
      checksum: body.checksum,
      deleted: false,
      status: 'pending_push',
      lastError: null,
    });
    externalStore.put(fileId, {
      name: fileName,
      ext,
      encoding,
      lineEnding,
      originalPath,
      content,
      checksum: body.checksum,
      rev: doc?.rev || externalDoc?.rev || 0,
    });
    syncStore.enqueueMutation({
      fileId,
      type: 'upsert',
      baseRev: doc?.lastKnownServerRev || doc?.rev || externalDoc?.rev || 0,
      dedupeKey: 'upsert',
      payload: {
        fileName,
        originalPath,
        source: options.source || 'external',
        content: body.content,
        rawContent: content,
        compressed: body.compressed,
        size: body.size,
        encoding,
        lineEnding,
        checksum: body.checksum,
        deviceId: useDeviceStore.getState().getId(),
        devicePath: '',
      },
    });
    if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
      this.fullSync();
    }
    return { ok: true, fileId };
  }

  async bindLocalPath(fileId, localPath, meta = {}) {
    if (!fileId || !localPath) return;
    useFileIdStore.getState().bind(localPath, fileId);
    useSyncStore.getState().bindLocalPath(fileId, localPath, {
      name: meta.name || basename(localPath),
      ext: meta.ext || extOf(meta.name || localPath),
      encoding: meta.encoding || 'UTF-8',
      lineEnding: meta.lineEnding || 'LF',
      deleted: false,
    });
    useSyncStore.getState().enqueueMutation({
      fileId,
      type: 'bind_path',
      baseRev: useSyncStore.getState().getDoc(fileId)?.lastKnownServerRev || 0,
      dedupeKey: 'bind_path',
      payload: {
        deviceId: useDeviceStore.getState().getId(),
        devicePath: localPath,
      },
    });
  }

  async rebindLocalPath(oldPath, newPath, name = '') {
    if (!oldPath || !newPath || oldPath === newPath) return;
    useFileIdStore.getState().movePath(oldPath, newPath);
    useFileStore.getState().replaceBookmarkPath(oldPath, newPath);
    useFileStore.getState().replaceRecentFilePath(oldPath, newPath, name);
    useSyncStore.getState().moveLocalPath(oldPath, newPath, {
      name: name || basename(newPath),
      ext: extOf(name || basename(newPath)),
    });
    const doc = useSyncStore.getState().findDocByPath(newPath);
    if (doc) {
      await this.bindLocalPath(doc.fileId, newPath, {
        name: name || basename(newPath),
        ext: extOf(name || basename(newPath)),
      });
      if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
        this.fullSync();
      }
    }
  }

  buildConflict(fileId, remoteDoc, remoteContent, localContentOverride) {
    const doc = useSyncStore.getState().getDoc(fileId);
    return {
      fileId,
      path: doc?.localPath || fileId,
      name: doc?.name || remoteDoc?.fileName || fileId,
      localContent: typeof localContentOverride === 'string'
        ? localContentOverride
        : getLocalConflictContent(doc?.localPath, fileId),
      remoteContent,
      remoteDoc,
    };
  }

  getOpenLocalState(fileId, localPath = '') {
    const editorStore = useEditorStore.getState();
    const localTab = localPath
      ? editorStore.getTabByPath?.(localPath) || editorStore.tabs.find((tab) => tab.path === localPath)
      : null;
    const externalTab = editorStore.getTabByExternalFileId?.(fileId)
      || editorStore.tabs.find((tab) => tab.externalFileId === fileId);
    const tab = localTab || externalTab || null;
    return {
      tab,
      localTab,
      externalTab,
      modified: !!tab?.modified,
      content: typeof tab?.content === 'string' ? tab.content : '',
    };
  }

  getRemoteConflictDecision(fileId, remoteContent, localPath = '', { force = false } = {}) {
    const localState = this.getOpenLocalState(fileId, localPath);
    if (force || useConfigStore.getState().autoSave) {
      return { shouldConflict: false, localState };
    }
    if (!localState.modified) {
      return { shouldConflict: false, localState };
    }
    return {
      shouldConflict: localState.content !== (remoteContent || ''),
      localState,
    };
  }

  async applyRemoteDoc(doc, { force = false } = {}) {
    if (!doc?.fileId) return null;
    const deviceId = useDeviceStore.getState().getId();
    const myPath = doc.deviceBindings?.[deviceId] || '';
    const syncStore = useSyncStore.getState();
    const editorStore = useEditorStore.getState();
    const existing = syncStore.getDoc(doc.fileId);

    if (doc.deleted) {
      const deleteDecision = this.getRemoteConflictDecision(doc.fileId, '', myPath, { force });
      if (syncStore.hasPendingMutation(doc.fileId) && deleteDecision.shouldConflict) {
        syncStore.markDeleted(doc.fileId, {
          rev: doc.rev || 0,
          lastKnownServerRev: doc.rev || 0,
          status: 'conflict',
        });
        syncStore.addConflict(
          this.buildConflict(doc.fileId, doc, '', deleteDecision.localState.content),
        );
        return { conflict: true };
      }
      if (syncStore.hasPendingMutation(doc.fileId) && !force) {
        syncStore.dropMutationsForFile(doc.fileId);
      }
      syncStore.markDeleted(doc.fileId, {
        rev: doc.rev || 0,
        lastKnownServerRev: doc.rev || 0,
        status: 'deleted',
      });
      useExternalDocsStore.getState().remove(doc.fileId);
      return { deleted: true };
    }

    let decoded = '';
    try {
      decoded = decodeBody(doc);
    } catch (err) {
      console.warn('[sync] failed to decode pulled doc', doc.fileId, err);
      return { writtenPath: null, external: true, decodeFailed: true };
    }

    if (syncStore.hasPendingMutation(doc.fileId) && !force) {
      const pendingDecision = this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
      if (pendingDecision.shouldConflict) {
        syncStore.upsertDoc(doc.fileId, {
          name: doc.fileName || basename(doc.originalPath || '') || doc.fileId,
          rev: doc.rev || existing?.rev || 0,
          lastKnownServerRev: doc.rev || existing?.lastKnownServerRev || 0,
          status: 'conflict',
        });
        syncStore.addConflict(
          this.buildConflict(doc.fileId, doc, decoded, pendingDecision.localState.content),
        );
        return { conflict: true };
      }
      syncStore.dropMutationsForFile(doc.fileId);
    }

    if (myPath) {
      const openTab = editorStore.getTabByPath?.(myPath)
        || editorStore.tabs.find((tab) => tab.path === myPath);
      const localDecision = this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
      if (localDecision.shouldConflict) {
        syncStore.upsertDoc(doc.fileId, {
          localPath: myPath,
          name: doc.fileName || basename(myPath),
          ext: extOf(doc.fileName || basename(myPath)),
          rev: doc.rev || 0,
          lastKnownServerRev: doc.rev || 0,
          checksum: doc.contentHash || doc.checksum || '',
          status: 'conflict',
          deleted: false,
        });
        syncStore.addConflict(
          this.buildConflict(
            doc.fileId,
            doc,
            decoded,
            localDecision.localState.content || openTab?.content || '',
          ),
        );
        return { conflict: true };
      }

      try {
        const result = await saveFile(myPath, decoded, doc.encoding || 'UTF-8');
        if (result?.success !== false) {
          useFileIdStore.getState().bind(myPath, doc.fileId);
          syncStore.bindLocalPath(doc.fileId, myPath, {
            name: doc.fileName || basename(myPath),
            ext: extOf(doc.fileName || basename(myPath)),
            encoding: doc.encoding || 'UTF-8',
            lineEnding: doc.lineEnding || 'LF',
            checksum: doc.contentHash || doc.checksum || '',
            rev: doc.rev || 0,
            lastKnownServerRev: doc.rev || 0,
            status: 'synced',
            deleted: false,
          });
          editorStore.replaceTabContentByPath(myPath, {
            name: doc.fileName || basename(myPath),
            content: decoded,
            encoding: doc.encoding || 'UTF-8',
            lineEnding: doc.lineEnding || 'LF',
          });
          useExternalDocsStore.getState().remove(doc.fileId);
          return { writtenPath: myPath, external: false };
        }
      } catch {
        // fall through to external representation below
      }
    }

    const externalDecision = this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
    if (externalDecision.shouldConflict) {
      syncStore.upsertDoc(doc.fileId, {
        name: doc.fileName || externalDecision.localState.tab?.name || doc.fileId,
        ext: extOf(doc.fileName || externalDecision.localState.tab?.name || ''),
        rev: doc.rev || 0,
        lastKnownServerRev: doc.rev || 0,
        checksum: doc.contentHash || doc.checksum || '',
        status: 'conflict',
        deleted: false,
      });
      syncStore.addConflict(
        this.buildConflict(doc.fileId, doc, decoded, externalDecision.localState.content || ''),
      );
      return { conflict: true };
    }

    syncStore.upsertDoc(doc.fileId, {
      name: doc.fileName || basename(doc.originalPath || '') || doc.fileId,
      ext: extOf(doc.fileName || doc.originalPath || ''),
      localPath: '',
      encoding: doc.encoding || 'UTF-8',
      lineEnding: doc.lineEnding || 'LF',
      checksum: doc.contentHash || doc.checksum || '',
      rev: doc.rev || 0,
      lastKnownServerRev: doc.rev || 0,
      status: 'synced',
      deleted: false,
    });
    useExternalDocsStore.getState().put(doc.fileId, {
      name: doc.fileName || basename(doc.originalPath || '') || doc.fileId,
      ext: extOf(doc.fileName || doc.originalPath || ''),
      encoding: doc.encoding || 'UTF-8',
      lineEnding: doc.lineEnding || 'LF',
      originalPath: doc.originalPath || '',
      content: decoded,
      checksum: doc.contentHash || doc.checksum || '',
      rev: doc.rev || 0,
    });
    editorStore.replaceTabContentByExternalFileId?.(doc.fileId, {
      name: doc.fileName || basename(doc.originalPath || '') || doc.fileId,
      ext: extOf(doc.fileName || doc.originalPath || ''),
      content: decoded,
      encoding: doc.encoding || 'UTF-8',
      lineEnding: doc.lineEnding || 'LF',
    });
    return { writtenPath: null, external: true };
  }

  async ensureExternalDoc(fileId) {
    if (!fileId) return null;
    const cached = useExternalDocsStore.getState().get(fileId);
    if (cached && typeof cached.content === 'string') return cached;
    try {
      const { data: doc } = await apiClient.get(`/sync/file/${encodeURIComponent(fileId)}`);
      if (!doc) return null;
      await this.applyRemoteDoc(doc);
      return useExternalDocsStore.getState().get(fileId);
    } catch (err) {
      console.warn('[sync] ensureExternalDoc failed', fileId, err);
      return null;
    }
  }

  async claimExternalDoc(fileId, localPath, content, encoding = 'UTF-8') {
    if (!fileId || !localPath) return { ok: false };
    await this.bindLocalPath(fileId, localPath, {
      name: basename(localPath),
      ext: extOf(localPath),
      encoding,
    });
    useExternalDocsStore.getState().remove(fileId);
    
    if (!useFileStore.getState().isBookmarked(localPath)) {
      useFileStore.getState().toggleBookmark(localPath);
    }
    
    return this.queueLocalUpsert(localPath, content, encoding, {
      name: basename(localPath),
      source: 'claim',
    });
  }

  async syncSettings() {
    await this.syncConfig();
  }

  async processMutation(item) {
    const syncStore = useSyncStore.getState();
    const doc = syncStore.getDoc(item.fileId);
    try {
      if (item.type === 'upsert') {
        const { data } = await apiClient.put(
          `/sync/file/${encodeURIComponent(item.fileId)}`,
          {
            ...item.payload,
            baseRev: Math.max(doc?.lastKnownServerRev || 0, item.baseRev || 0),
            mutationId: item.mutationId,
          },
        );
        syncStore.upsertDoc(item.fileId, {
          name: item.payload.fileName || doc?.name || item.fileId,
          ext: doc?.ext || extOf(item.payload.fileName || ''),
          localPath: item.payload.devicePath || doc?.localPath || '',
          encoding: item.payload.encoding || doc?.encoding || 'UTF-8',
          lineEnding: item.payload.lineEnding || doc?.lineEnding || 'LF',
          checksum: data.contentHash || data.checksum || item.payload.checksum,
          rev: data.rev || (doc?.rev || 0),
          lastKnownServerRev: data.rev || (doc?.lastKnownServerRev || 0),
          status: 'synced',
          deleted: false,
          lastError: null,
        });
        if (!(item.payload.devicePath || doc?.localPath)) {
          useExternalDocsStore.getState().put(item.fileId, {
            name: item.payload.fileName || doc?.name || item.fileId,
            ext: doc?.ext || extOf(item.payload.fileName || ''),
            encoding: item.payload.encoding || doc?.encoding || 'UTF-8',
            lineEnding: item.payload.lineEnding || doc?.lineEnding || 'LF',
            originalPath: item.payload.originalPath || '',
            content: item.payload.rawContent || '',
            checksum: data.contentHash || data.checksum || item.payload.checksum,
            rev: data.rev || (doc?.rev || 0),
          });
        }
        syncStore.completeMutation(item.mutationId);
        return true;
      }

      if (item.type === 'bind_path') {
        const { data } = await apiClient.post(
          `/sync/bindings/${encodeURIComponent(item.fileId)}`,
          {
            ...item.payload,
            mutationId: item.mutationId,
          },
        );
        syncStore.upsertDoc(item.fileId, {
          localPath: item.payload.devicePath || doc?.localPath || '',
          status: syncStore.hasPendingMutation(item.fileId) ? doc?.status || 'idle' : 'synced',
          lastKnownServerRev: data?.rev || doc?.lastKnownServerRev || 0,
        });
        syncStore.completeMutation(item.mutationId);
        return true;
      }

      if (item.type === 'delete') {
        const { data } = await apiClient.delete(
          `/sync/file/${encodeURIComponent(item.fileId)}`,
          {
            data: {
              baseRev: item.baseRev,
              mutationId: item.mutationId,
            },
          },
        );
        syncStore.markDeleted(item.fileId, {
          rev: data?.rev || doc?.rev || 0,
          lastKnownServerRev: data?.rev || doc?.lastKnownServerRev || 0,
          status: 'deleted',
        });
        useExternalDocsStore.getState().remove(item.fileId);
        syncStore.completeMutation(item.mutationId);
        return true;
      }
    } catch (err) {
      if (err?.response?.status === 409) {
        const current = err.response?.data?.current;
        let remoteDoc = current;
        if (current?.fileId && !current.content && !current.deleted) {
          const { data } = await apiClient.get(`/sync/file/${encodeURIComponent(current.fileId)}`);
          remoteDoc = data || current;
        }
        const remoteContent = remoteDoc?.deleted ? '' : decodeBody(remoteDoc || {});
        const localPath = item.payload?.devicePath || doc?.localPath || '';
        const decision = this.getRemoteConflictDecision(item.fileId, remoteContent, localPath);
        useSyncStore.getState().completeMutation(item.mutationId);
        if (!decision.shouldConflict) {
          if (remoteDoc) {
            await this.applyRemoteDoc(remoteDoc, { force: true });
          }
          return true;
        }
        useSyncStore.getState().upsertDoc(item.fileId, {
          status: 'conflict',
          rev: remoteDoc?.rev || doc?.rev || 0,
          lastKnownServerRev: remoteDoc?.rev || doc?.lastKnownServerRev || 0,
          deleted: !!remoteDoc?.deleted,
        });
        useSyncStore.getState().addConflict(
          this.buildConflict(
            item.fileId,
            remoteDoc || current || {},
            remoteContent,
            decision.localState.content,
          ),
        );
        this.setStatus('conflict');
        return true;
      }

      const kind = classifyApiError(err);
      useSyncStore.getState().failMutation(
        item.mutationId,
        err?.response?.data?.message || err?.message || 'sync failed',
      );
      useSyncStore.getState().setLastSyncError({
        kind,
        message: err?.response?.data?.message || err?.message || 'sync failed',
      });
      this.setStatus(kind === 'server_unreachable' ? 'server_unreachable' : kind);
      this.scheduleRetry();
      return false;
    }
    return true;
  }

  async processQueue() {
    const syncStore = useSyncStore.getState();
    let item = syncStore.getReadyMutation();
    while (item) {
      syncStore.markMutationProcessing(item.mutationId);
      const ok = await this.processMutation(item);
      if (!ok) return false;
      item = useSyncStore.getState().getReadyMutation();
    }
    return true;
  }

  async pullRemoteChanges() {
    const syncStore = useSyncStore.getState();
    const cursor = syncStore.getCursor();
    const { data } = await apiClient.get('/sync/changes', {
      params: cursor ? { since: cursor } : {},
    });
    for (const change of data?.changes || []) {
      if (!change?.fileId) continue;
      const localDoc = useSyncStore.getState().getDoc(change.fileId);
      if (localDoc && (localDoc.lastKnownServerRev || 0) >= (change.rev || 0)) {
        continue;
      }
      if (change.deleted) {
        await this.applyRemoteDoc(change);
        continue;
      }
      const { data: fullDoc } = await apiClient.get(
        `/sync/file/${encodeURIComponent(change.fileId)}`,
      );
      if (fullDoc) {
        await this.applyRemoteDoc(fullDoc);
      }
    }
    useSyncStore.getState().setCursor(data?.cursor || cursor || '');
    useSyncStore.getState().clearDeletedWithoutPath();
  }

  async pushSingle(filePath, content, encoding = 'UTF-8', source = 'manual') {
    return this.queueLocalUpsert(filePath, content, encoding, {
      name: basename(filePath),
      source,
    });
  }

  async deleteDocument(fileId) {
    if (!fileId) return;
    const syncStore = useSyncStore.getState();
    const doc = syncStore.getDoc(fileId);
    syncStore.dropMutationsForFile(fileId);
    syncStore.markDeleted(fileId, { status: 'pending_push' });
    syncStore.enqueueMutation({
      fileId,
      type: 'delete',
      baseRev: doc?.lastKnownServerRev || doc?.rev || 0,
      dedupeKey: 'delete',
      payload: {},
    });
    useExternalDocsStore.getState().remove(fileId);
    if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
      this.fullSync();
    }
  }

  async resolveConflict(fileId, resolution) {
    const conflict = useSyncStore.getState().listConflicts().find((item) => item.fileId === fileId);
    if (!conflict) return;
    useSyncStore.getState().resolveConflict(fileId);
    if (resolution === 'remote') {
      await this.applyRemoteDoc(conflict.remoteDoc, { force: true });
    } else if (resolution === 'local') {
      const doc = useSyncStore.getState().getDoc(fileId);
      const localPath = doc?.localPath || '';
      const content = conflict.localContent || '';
      if (localPath) {
        await this.queueLocalUpsert(localPath, content, doc?.encoding || 'UTF-8', {
          name: doc?.name || basename(localPath),
          lineEnding: doc?.lineEnding || 'LF',
          source: 'conflict',
        });
      }
    }
    const remainingConflicts = useSyncStore.getState().listConflicts().length;
    if (remainingConflicts === 0 && !useSyncStore.getState().listQueue().length) {
      this.setStatus('synced');
    }
  }

  async syncConfig(options = {}) {
    try {
      const remoteConfig = await this.ensureRemoteProtocol();
      const remoteUpdatedAt = Number(remoteConfig?.updatedAt || 0);
      const localUpdatedAt = this.getLocalConfigUpdatedAt();

      if (options.preferRemote) {
        this.applyRemoteConfig(remoteConfig);
        return remoteConfig;
      }

      if (remoteUpdatedAt > localUpdatedAt) {
        this.applyRemoteConfig(remoteConfig);
        return remoteConfig;
      }

      if (localUpdatedAt > remoteUpdatedAt || remoteUpdatedAt === 0) {
        const payload = buildConfigPayload();
        await apiClient.put('/sync/config', payload);
        return payload;
      }

      return remoteConfig;
    } catch (err) {
      const kind = classifyApiError(err);
      useSyncStore.getState().setLastSyncError({
        kind,
        message: err?.response?.data?.message || err?.message || 'config sync failed',
      });
      this.setStatus(kind === 'server_unreachable' ? 'server_unreachable' : kind);
      throw err;
    }
  }

  async fullSync() {
    if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) {
      return;
    }
    if (this.syncing) return;
    this.syncing = true;
    this.setStatus('syncing');
    try {
      await this.ensureLocalReset();
      await this.ensureRemoteProtocol();
      await this.syncConfig();
      const queueOk = await this.processQueue();
      if (queueOk) {
        await this.pullRemoteChanges();
        await this.syncConfig();
      }
      if (useSyncStore.getState().listConflicts().length > 0) {
        this.setStatus('conflict');
      } else if (useSyncStore.getState().listQueue().length > 0) {
        this.scheduleRetry();
        this.setStatus('idle');
      } else {
        this.setStatus('synced');
      }
    } catch (err) {
      const kind = classifyApiError(err);
      useSyncStore.getState().setLastSyncError({
        kind,
        message: err?.response?.data?.message || err?.message || 'sync failed',
      });
      this.setStatus(kind === 'server_unreachable' ? 'server_unreachable' : kind);
      useNotificationStore.getState().notify(
        'error',
        'Sync failed',
        err?.response?.data?.message || String(err?.message || err),
      );
      if (this.shouldRetry(kind)) {
        this.scheduleRetry();
      }
    } finally {
      this.syncing = false;
    }
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
