/**
 * 云同步引擎入口。
 *
 * 本文件统一封装本地文件、external 文档缓存、配置镜像以及远端同步协议之间的
 * 协作流程，对外提供入队、拉取、冲突处理、路径绑定与配置同步等核心能力。
 */
import { classifyApiError } from './apiClient';
import { readFileContent, recordDiagnostic, saveFile } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import useFileStore, { getScopedBookmarkedPaths } from '@store/useFileStore';
import useFileIdStore from '@store/useFileIdStore';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useNotificationStore from '@store/useNotificationStore';
import useAuthStore from '@store/useAuthStore';
import useDeviceStore from '@store/useDeviceStore';
import useExternalDocsStore, { getScopedExternalDocsMap } from '@store/useExternalDocsStore';
import useSyncStore, {
  waitForSyncStatePersistence,
  waitForSyncStoreHydration,
} from '@store/useSyncStore';
import { getCurrentUserScopeId } from '@store/userScope';
import { getLocalSettingsSnapshot, applySettingsSnapshot } from '@utils/settingsSync';
import {
  decodeAndVerifySyncBody,
  decodeSyncBody,
  encodeSyncBody,
  isSyncBodyTooLarge,
  sha256Text,
  SyncIntegrityError,
} from './sync/contentCodec';
import { getMutationRetryAt, isRetryableSyncError } from './sync/retryPolicy';
import { syncTransport } from './sync/syncTransport';
import { SyncProtocolError } from './sync/changeProtocol';
import i18n from '@/i18n';

const CONFIG_SYNC_DEBOUNCE_MS = 900;
const PULL_WORKER_COUNT = 3;
export const CLOUD_PATH_PREFIX = 'cloud://';

/**
 * 根据 `fileId` 构造统一的云文档路径。
 *
 * @param {string} fileId 云端文档标识
 * @returns {string} 形如 `cloud://<fileId>` 的逻辑路径
 */
export function makeCloudPath(fileId) {
  return `${CLOUD_PATH_PREFIX}${fileId}`;
}

/**
 * 判断给定路径是否属于云文档逻辑路径。
 *
 * @param {string} p 待判断路径
 * @returns {boolean} 是否为 `cloud://` 前缀路径
 */
export function isCloudPath(p) {
  return typeof p === 'string' && p.startsWith(CLOUD_PATH_PREFIX);
}

/**
 * 从云文档逻辑路径中还原 `fileId`。
 *
 * @param {string} p 云文档逻辑路径
 * @returns {string | null} 提取出的 `fileId`；非云路径时返回 `null`
 */
export function fileIdFromCloudPath(p) {
  return isCloudPath(p) ? p.slice(CLOUD_PATH_PREFIX.length) : null;
}

/**
 * 提取路径末尾的文件名。
 */
function basename(p) {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * 提取文件扩展名并统一为小写。
 */
function extOf(name) {
  if (!name) return '';
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/**
 * 构造当前本地设置快照，供配置同步上推。
 */
function buildConfigPayload() {
  return getLocalSettingsSnapshot();
}

/**
 * 从编辑器或 external 文档缓存中提取本地冲突正文。
 */
function getLocalConflictContent(path, fileId) {
  const editor = useEditorStore.getState();
  const tab = editor.getTabByPath?.(path)
    || editor.tabs.find((item) => item.path === path || item.externalFileId === fileId);
  if (tab?.content) return tab.content;
  return useExternalDocsStore.getState().get(fileId)?.content || '';
}

/**
 * 云同步核心引擎。
 *
 * 负责本地文件与外部云文档的统一建模、变更入队、推送/拉取、路径绑定、
 * 冲突判定、配置同步以及失败重试，是整个同步能力的单一调度入口。
 */
export class SyncEngine {
  constructor({ transport = syncTransport, autoSubscribe = true } = {}) {
    this.transport = transport;
    this.status = 'idle';
    this.listeners = new Set();
    this.retryTimer = null;
    this.syncing = false;
    this.syncRequested = false;
    this.syncPromise = null;
    this.configSyncTimer = null;
    this.suppressConfigAutoSync = false;
    this.lastErrorNotification = '';
    if (autoSubscribe) this.setupConfigSubscriptions();
  }

  /**
   * 订阅会影响“云端配置镜像”的本地 store。
   *
   * 这些状态虽然分散在多个 store 中，但从同步视角看都属于同一份用户配置，
   * 所以在引擎层集中节流并上推。
   */
  setupConfigSubscriptions() {
    useConfigStore.subscribe((state, prev) => {
      if (!prev.syncEnabled && state.syncEnabled) {
        if (useAuthStore.getState().isLoggedIn) this.fullSync();
        return;
      }
      if ((state.syncableConfigUpdatedAt || 0) !== (prev.syncableConfigUpdatedAt || 0)) {
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
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
          this.fullSync();
        }
      });
    }
  }

  /**
   * 节流触发配置同步，避免短时间内多个 store 连续变更造成重复请求。
   */
  scheduleConfigSync() {
    if (this.suppressConfigAutoSync) return;
    if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) return;
    if (this.syncing) {
      this.syncRequested = true;
      return;
    }
    if (this.configSyncTimer) clearTimeout(this.configSyncTimer);
    this.configSyncTimer = setTimeout(() => {
      this.configSyncTimer = null;
      this.syncConfig().catch(() => {});
    }, CONFIG_SYNC_DEBOUNCE_MS);
  }

  /**
   * 读取本地配置快照的最新更新时间。
   */
  getLocalConfigUpdatedAt() {
    return Number(buildConfigPayload().updatedAt || 0);
  }

  /**
   * 将远端配置镜像应用到本地，并临时关闭自动回推，避免形成同步回环。
   */
  applyRemoteConfig(remoteConfig = {}) {
    this.suppressConfigAutoSync = true;
    try {
      applySettingsSnapshot(remoteConfig, { includeDeviceLocal: false });
    } finally {
      this.suppressConfigAutoSync = false;
    }
  }

  /**
   * 订阅同步状态变化。
   *
   * @param {(status: string) => void} fn 状态变化回调
   * @returns {() => boolean} 取消订阅函数
   */
  onStatusChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 更新当前同步状态，并通知所有订阅者。
   *
   * @param {string} s 新的同步状态
   */
  setStatus(s) {
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * 按 store 中记录的下次重试时间安排一次完整同步。
   */
  scheduleRetry(overrideAt = null) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const nextAt = overrideAt || useSyncStore.getState().getNextRetryAt();
    if (!nextAt) return;
    const delay = Math.min(2_147_483_647, Math.max(0, nextAt - Date.now()));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
        this.fullSync();
      }
    }, delay);
  }

  /**
   * 判断当前错误类型是否值得自动重试。
   *
   * @param {string} kind 分类后的同步错误类型
   * @returns {boolean} 是否进入重试流程
   */
  shouldRetry(kind) {
    return isRetryableSyncError(kind);
  }

  /**
   * 等待持久状态恢复，并把崩溃遗留的 processing lease 重新放回 outbox。
   *
   * 旧实现会在这里删除映射、正文镜像和待推队列；启动准备现在严格保持
   * 非破坏性，任何协议/本地 schema 升级都不得以清空用户数据完成。
   */
  async ensureLocalReset() {
    await waitForSyncStoreHydration();
    const syncStore = useSyncStore.getState();
    syncStore.recoverInterruptedMutations();
    if (!syncStore.isLocalResetDone()) syncStore.markLocalResetDone();
    await waitForSyncStatePersistence();
  }

  /**
   * 只读获取远端配置。服务能力由 `/changes` 响应形状协商，配置里的
   * protocolVersion 只作为历史元数据，不再触发任何远端 reset。
   */
  async ensureRemoteProtocol() {
    return this.transport.getConfig();
  }

  assertActiveScope(expectedScope) {
    if (
      expectedScope
      && (!useAuthStore.getState().isLoggedIn || getCurrentUserScopeId() !== expectedScope)
    ) {
      const error = new Error('The sync account changed while a request was in flight');
      error.code = 'SYNC_SESSION_CHANGED';
      throw error;
    }
  }

  /**
   * Low-frequency reconciliation repairs edits that happened while sync was paused,
   * before the autosave outbox write, or in a previous crashed process.
   */
  async reconcileLocalBookmarks(expectedScope = getCurrentUserScopeId()) {
    const syncStore = useSyncStore.getState();
    const linkedPaths = syncStore.listReplicas()
      .filter((replica) => replica.linkState === 'linked' && replica.localPath)
      .map((replica) => replica.localPath);
    // One-way compatibility bridge for pre-v5 state. Once a legacy bookmark is
    // converted into a replica, all future reconciliation is replica-driven.
    const legacyPaths = getScopedBookmarkedPaths(
      useFileStore.getState().bookmarkedPaths,
      expectedScope,
    ).filter((path) => !isCloudPath(path) && !syncStore.findReplicaByPath(path));
    const paths = [...new Set([...linkedPaths, ...legacyPaths])];

    for (const filePath of paths) {
      this.assertActiveScope(expectedScope);
      let result;
      try {
        result = await readFileContent(filePath);
      } catch {
        continue;
      }
      if (!result || result.success === false || typeof result.content !== 'string') continue;

      const fileId = this.registerLocalDocument(filePath, {
        name: result.file_name || basename(filePath),
        encoding: result.encoding || 'UTF-8',
        lineEnding: result.line_ending || 'LF',
        source: 'reconcile',
      });
      if (!fileId) continue;

      const checksum = await sha256Text(result.content);
      const syncStore = useSyncStore.getState();
      const doc = syncStore.getDoc(fileId);
      const pendingChecksum = syncStore.getPendingUpsertPayload(fileId)?.checksum || '';
      if (
        pendingChecksum === checksum
        || (
          !pendingChecksum
          && doc?.localChecksum === checksum
          && doc?.serverChecksum === checksum
        )
      ) {
        continue;
      }
      await this.queueLocalUpsert(filePath, result.content, result.encoding || 'UTF-8', {
        name: result.file_name || basename(filePath),
        lineEnding: result.line_ending || 'LF',
        source: 'reconcile',
        forceTracking: legacyPaths.includes(filePath),
        linkReplica: legacyPaths.includes(filePath),
        deferSync: true,
      });
    }

    const externalDocs = Object.values(getScopedExternalDocsMap(
      useExternalDocsStore.getState().docs,
      expectedScope,
    ));
    for (const externalDoc of externalDocs) {
      this.assertActiveScope(expectedScope);
      if (!externalDoc?.fileId || typeof externalDoc.content !== 'string') continue;
      const checksum = await sha256Text(externalDoc.content);
      this.assertActiveScope(expectedScope);
      const syncStore = useSyncStore.getState();
      const doc = syncStore.getDoc(externalDoc.fileId);
      const pendingChecksum = syncStore.getPendingUpsertPayload(externalDoc.fileId)?.checksum || '';
      if (
        pendingChecksum === checksum
        || (!pendingChecksum && doc?.serverChecksum === checksum)
      ) continue;
      await this.queueExternalUpsert(
        externalDoc.fileId,
        externalDoc.content,
        externalDoc.encoding || 'UTF-8',
        {
          name: externalDoc.name,
          lineEnding: externalDoc.lineEnding || 'LF',
          source: 'reconcile',
          deferSync: true,
        },
      );
    }
  }

  /**
   * 在同步层登记一个本地文档，并确保其与 `fileId` 绑定。
   */
  registerLocalDocument(filePath, meta = {}) {
    if (!filePath || isCloudPath(filePath)) return null;
    const fileIdStore = useFileIdStore.getState();
    const syncStore = useSyncStore.getState();
    const existingFileId = fileIdStore.idOf(filePath);
    // A local path receives a cloud identity only through an explicit link
    // action or an existing durable mapping. Merely opening a file is inert.
    let fileId = meta.fileId || existingFileId;
    if (!fileId && meta.linkReplica) {
      fileId = fileIdStore.getOrCreate(filePath);
    }

    if (!fileId) return null;

    const existingDoc = syncStore.getDoc(fileId);
    const existingReplica = syncStore.getReplica(fileId);
    fileIdStore.bind(filePath, fileId);
    const syncPatch = {
      name: meta.name || basename(filePath),
      ext: meta.ext || extOf(meta.name || filePath),
      encoding: meta.encoding || 'UTF-8',
      lineEnding: meta.lineEnding || 'LF',
      source: meta.source || 'local',
      deleted: false,
      // Opening or saving a server-bound file must not silently stop tracking
      // it merely because bookmark UI state is temporarily absent.
      enrolled: meta.enrolled
        ?? (existingReplica
          ? existingReplica.linkState === 'linked'
          : existingDoc?.enrolled ?? false),
    };
    if (meta.status) syncPatch.status = meta.status;
    syncStore.bindLocalPath(fileId, filePath, syncPatch);
    return fileId;
  }

  /**
   * Stop following a local path without deleting its cloud copy. The stable
   * fileId is retained so an explicit re-enrollment can safely reuse history.
   */
  async stopTrackingLocal(filePath) {
    if (!filePath || isCloudPath(filePath)) return { ok: false };
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);
    const fileId = useFileIdStore.getState().idOf(filePath);
    if (!fileId) return { ok: true, skipped: 'not-enrolled' };
    const syncStore = useSyncStore.getState();
    if (syncStore.listConflicts().some((item) => item.fileId === fileId)) {
      return { ok: false, reason: 'resolve-conflict-first' };
    }
    syncStore.cancelQueuedMutationsForFile(fileId);
    const replica = syncStore.getReplica(fileId);
    syncStore.upsertDocumentAndReplica(
      fileId,
      {
        enrolled: false,
        status: syncStore.hasPendingMutation(fileId) ? 'pending_push' : 'stopped',
      },
      {
        ...replica,
        localPath: replica?.localPath || filePath,
        linkState: 'unlinked',
        stoppedAt: Date.now(),
      },
    );
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    return { ok: true, fileId };
  }

  /**
   * 把本地文件内容入同步队列。
   */
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
    if (!useAuthStore.getState().isLoggedIn) {
      return { ok: true, skipped: 'auth-required' };
    }
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);

    const syncStore = useSyncStore.getState();
    const existingFileId = useFileIdStore.getState().idOf(filePath);
    const existingReplica = existingFileId ? syncStore.getReplica(existingFileId) : null;
    const isLinked = existingReplica?.linkState === 'linked';
    const explicitlyTracked = options.forceTracking
      || ['bookmark-add', 'claim', 'conflict', 'manual'].includes(options.source);

    // fileId 只表示稳定身份；收藏/enrollment 才表示用户仍希望持续同步。
    if (!isLinked && !explicitlyTracked) {
      return { ok: true, skipped: 'not-enrolled' };
    }
    if (existingFileId && syncStore.hasPendingDelete(existingFileId)) {
      return { ok: false, reason: 'deletion-pending' };
    }

    const fileId = this.registerLocalDocument(filePath, {
      name: options.name || basename(filePath),
      encoding,
      lineEnding: options.lineEnding || 'LF',
      source: options.source || 'local',
      linkReplica: options.linkReplica || explicitlyTracked,
      enrolled: options.linkReplica || explicitlyTracked || isLinked,
    });

    if (!fileId) {
      return { ok: true, skipped: 'not-bookmarked' };
    }

    const doc = syncStore.getDoc(fileId);
    const fileName = options.name || basename(filePath);
    const lineEnding = options.lineEnding || doc?.lineEnding || 'LF';
    const body = options.preparedBody || await encodeSyncBody(content);
    this.assertActiveScope(expectedScope);
    const payload = {
      fileName,
      originalPath: filePath,
      source: options.source || 'local',
      content: body.content,
      compressed: body.compressed,
      size: body.size,
      encoding,
      lineEnding,
      checksum: body.checksum,
      deviceId: useDeviceStore.getState().getId(),
      devicePath: filePath,
    };
    if (isSyncBodyTooLarge(body, payload)) {
      useSyncStore.getState().upsertDoc(fileId, {
        localChecksum: body.checksum,
        status: 'error',
        lastError: 'Document exceeds the sync request limit',
      });
      useSyncStore.getState().setLastSyncError({
        kind: 'payload_too_large',
        message: 'Document exceeds the sync request limit',
        fileId,
      });
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
      return {
        ok: false,
        reason: 'too-large',
        size: body.size,
        compressed: body.wireBytes,
      };
    }
    if (syncStore.hasPendingDelete(fileId)) {
      return { ok: false, reason: 'deletion-pending' };
    }
    const docPatch = {
      name: fileName || doc?.name || basename(filePath),
      ext: doc?.ext || extOf(fileName),
      localPath: filePath,
      encoding,
      lineEnding,
      localChecksum: body.checksum,
      deleted: false,
      status: 'pending_push',
      lastError: null,
      enrolled: true,
    };
    if (!options.resolveConflict && syncStore.updateConflictLocal(fileId, content, docPatch)) {
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
      return { ok: true, fileId, queued: false, conflict: true };
    }
    // 同一文件在队列中只保留一条去重后的 upsert，后续编辑会覆盖旧载荷，
    // 从而确保真正出队的始终是最新内容快照。
    const enqueue = options.resolveConflict
      ? syncStore.replaceConflictWithMutation
      : syncStore.enqueueMutation;
    const mutationId = enqueue({
      fileId,
      type: 'upsert',
      baseRev: doc?.lastKnownServerRev || doc?.rev || 0,
      dedupeKey: 'upsert',
      payload,
      docPatch,
      replicaPatch: {
        deviceId: payload.deviceId,
        localPath: filePath,
        linkState: 'linked',
        baseRev: Number(doc?.lastKnownServerRev || doc?.rev || 0),
        baseChecksum: doc?.serverChecksum || '',
        localChecksum: body.checksum,
      },
    });
    if (!mutationId) {
      if (syncStore.hasPendingDelete(fileId)) {
        return { ok: false, reason: 'deletion-pending' };
      }
      return options.resolveConflict
        ? { ok: false, reason: 'conflict-state-changed' }
        : { ok: true, fileId, queued: false, conflict: true };
    }
    // The durable outbox must reach storage before a request can leave the process.
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    if (
      !options.deferSync
      && useConfigStore.getState().syncEnabled
    ) {
      this.fullSync();
    }
    return {
      ok: true,
      fileId,
      queued: true,
      paused: !useConfigStore.getState().syncEnabled,
    };
  }

  /**
   * 把仅存在于 external 缓存区的云文档内容入同步队列。
   */
  async queueExternalUpsert(fileId, content, encoding = 'UTF-8', options = {}) {
    if (!fileId) {
      return { ok: false, reason: 'invalid-fileId' };
    }
    if (typeof content !== 'string') {
      return { ok: false, reason: 'missing-content' };
    }
    if (!useAuthStore.getState().isLoggedIn) {
      return { ok: false, reason: 'auth-required' };
    }
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);

    const syncStore = useSyncStore.getState();
    const externalStore = useExternalDocsStore.getState();
    const doc = syncStore.getDoc(fileId);
    const externalDoc = externalStore.get(fileId);
    if (syncStore.hasPendingDelete(fileId)) {
      return { ok: false, reason: 'deletion-pending' };
    }

    const fileName = options.name || doc?.name || externalDoc?.name || fileId;
    const ext = doc?.ext || externalDoc?.ext || extOf(fileName);
    const lineEnding = options.lineEnding || doc?.lineEnding || externalDoc?.lineEnding || 'LF';
    const originalPath = externalDoc?.originalPath || doc?.localPath || '';
    const body = options.preparedBody || await encodeSyncBody(content);
    this.assertActiveScope(expectedScope);
    const payload = {
      fileName,
      originalPath,
      source: options.source || 'external',
      content: body.content,
      compressed: body.compressed,
      size: body.size,
      encoding,
      lineEnding,
      checksum: body.checksum,
      deviceId: useDeviceStore.getState().getId(),
      devicePath: '',
    };
    if (isSyncBodyTooLarge(body, payload)) {
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
      syncStore.upsertDoc(fileId, {
        name: fileName,
        ext,
        localPath: '',
        encoding,
        lineEnding,
        localChecksum: body.checksum,
        status: 'error',
        lastError: 'Document exceeds the sync request limit',
      });
      syncStore.setLastSyncError({
        kind: 'payload_too_large',
        message: 'Document exceeds the sync request limit',
        fileId,
      });
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
      return {
        ok: false,
        reason: 'too-large',
        size: body.size,
        compressed: body.wireBytes,
      };
    }

    const docPatch = {
      name: fileName,
      ext,
      localPath: '',
      encoding,
      lineEnding,
      localChecksum: body.checksum,
      deleted: false,
      status: 'pending_push',
      lastError: null,
      enrolled: true,
    };
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
    if (!options.resolveConflict && syncStore.updateConflictLocal(fileId, content, docPatch)) {
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
      return { ok: true, fileId, queued: false, conflict: true };
    }
    const enqueue = options.resolveConflict
      ? syncStore.replaceConflictWithMutation
      : syncStore.enqueueMutation;
    const mutationId = enqueue({
      fileId,
      type: 'upsert',
      baseRev: doc?.lastKnownServerRev || doc?.rev || externalDoc?.rev || 0,
      dedupeKey: 'upsert',
      payload,
      docPatch,
    });
    if (!mutationId) {
      if (syncStore.hasPendingDelete(fileId)) {
        return { ok: false, reason: 'deletion-pending' };
      }
      return options.resolveConflict
        ? { ok: false, reason: 'conflict-state-changed' }
        : { ok: true, fileId, queued: false, conflict: true };
    }
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    if (!options.deferSync && useConfigStore.getState().syncEnabled) {
      this.fullSync();
    }
    return {
      ok: true,
      fileId,
      queued: true,
      paused: !useConfigStore.getState().syncEnabled,
    };
  }

  /**
   * 记录“该云文档在当前设备对应哪个本地路径”。
   *
   * 这类绑定会同步到服务端，供跨设备回填相同文档的本地落点与冲突判断。
   */
  async bindLocalPath(fileId, localPath, meta = {}) {
    if (!fileId || !localPath) return;
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);
    useFileIdStore.getState().bind(localPath, fileId);
    const syncStore = useSyncStore.getState();
    const docPatch = {
      localPath,
      name: meta.name || basename(localPath),
      ext: meta.ext || extOf(meta.name || localPath),
      encoding: meta.encoding || 'UTF-8',
      lineEnding: meta.lineEnding || 'LF',
      deleted: false,
      enrolled: true,
    };
    const mutationId = syncStore.enqueueMutation({
      fileId,
      type: 'bind_path',
      baseRev: syncStore.getDoc(fileId)?.lastKnownServerRev || 0,
      dedupeKey: 'bind_path',
      payload: {
        deviceId: useDeviceStore.getState().getId(),
        devicePath: localPath,
      },
      docPatch,
      replicaPatch: {
        deviceId: useDeviceStore.getState().getId(),
        localPath,
        linkState: 'linked',
        baseRev: syncStore.getDoc(fileId)?.lastKnownServerRev || 0,
        baseChecksum: syncStore.getDoc(fileId)?.serverChecksum || '',
        localChecksum: syncStore.getDoc(fileId)?.localChecksum || '',
      },
    });
    if (!mutationId && !syncStore.hasPendingDelete(fileId)) {
      syncStore.upsertDoc(fileId, docPatch);
    }
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
  }

  /**
   * 在本地路径变更后，迁移与该文档相关的所有本地绑定关系。
   *
   * @param {string} oldPath 旧路径
   * @param {string} newPath 新路径
   * @param {string} [name=''] 可选的新文件名
   * @returns {Promise<void>}
   */
  async rebindLocalPath(oldPath, newPath, name = '') {
    if (!oldPath || !newPath || oldPath === newPath) return;
    useFileIdStore.getState().movePath(oldPath, newPath);
    useFileStore.getState().replaceBookmarkPath(oldPath, newPath);
    useFileStore.getState().replaceRecentFilePath(oldPath, newPath, name);
    const syncStore = useSyncStore.getState();
    syncStore.moveLocalPath(oldPath, newPath, {
      name: name || basename(newPath),
      ext: extOf(name || basename(newPath)),
    });
    const replica = syncStore.findReplicaByPath(oldPath) || syncStore.findReplicaByPath(newPath);
    const doc = syncStore.findDocByPath(newPath);
    const fileId = replica?.fileId || doc?.fileId;
    if (fileId && replica?.linkState === 'linked') {
      syncStore.upsertReplica(fileId, { ...replica, localPath: newPath });
      await this.bindLocalPath(fileId, newPath, {
        name: name || basename(newPath),
        ext: extOf(name || basename(newPath)),
      });
      if (useAuthStore.getState().isLoggedIn && useConfigStore.getState().syncEnabled) {
        this.fullSync();
      }
    }
  }

  /**
   * 构造统一格式的冲突对象，供冲突面板直接消费。
   */
  buildConflict(fileId, remoteDoc, remoteContent, localContentOverride, meta = {}) {
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
      ...meta,
    };
  }

  /**
   * 读取当前打开文档在本地编辑器中的实时状态。
   */
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

  /**
   * 决定远端变更是否需要升级为冲突。
   */
  async getRemoteConflictDecision(fileId, remoteContent, localPath = '', { force = false } = {}) {
    const localState = this.getOpenLocalState(fileId, localPath);
    // 冲突解决阶段已明确选择远端，放行覆盖即可。
    if (force) {
      return { shouldConflict: false, localState };
    }

    const remote = remoteContent || '';
    const syncStore = useSyncStore.getState();
    const doc = syncStore.getDoc(fileId);
    const pendingDelete = syncStore.listQueue().some((item) =>
      item.fileId === fileId
      && item.type === 'delete'
      && ['staged', 'pending', 'processing', 'blocked'].includes(item.status)
    );
    if (pendingDelete) {
      return {
        shouldConflict: remote !== '',
        localDeleted: true,
        localState: { ...localState, content: '' },
      };
    }

    // 本地“权威内容”优先取同步队列里待推送的内容；否则取编辑器里打开的实时内容
    // （getOpenLocalState 已合并 editorBuffer）。自动保存会在推送后立刻清掉 modified
    // 标记，所以不能只看 modified，必须以真实内容做比对。
    const pendingPayload = useSyncStore.getState().getPendingUpsertPayload?.(fileId);
    let pendingContent;
    try {
      pendingContent = pendingPayload ? decodeSyncBody(pendingPayload) : undefined;
    } catch {
      pendingContent = undefined;
    }
    let localContent = null;
    if (typeof pendingContent === 'string') {
      localContent = pendingContent;
    } else if (localState.tab) {
      localContent = typeof localState.content === 'string' ? localState.content : '';
    }

    // 既没有待推送内容、文件也没在编辑器里打开：本地没有需要保护的改动，
    // 属于纯拉取，直接接受远端。
    if (localContent === null) {
      return { shouldConflict: false, localState };
    }

    // 本地与远端内容一致：没有分叉。
    if (localContent === remote) {
      return { shouldConflict: false, localState: { ...localState, content: localContent } };
    }

    // 关键：判断本地是否真的相对“上次已知的服务端内容”发生了改动。若本地内容的
    // 校验和与服务端上次记录一致，说明本地只是落后于远端（别的设备做了合法的后续
    // 修改），直接接受远端即可，不应误报冲突；只有当本地已自行改动、且与远端不同，
    // 才是真正需要用户裁决的冲突。
    const lastServerChecksum = doc?.serverChecksum || doc?.checksum || '';
    if (lastServerChecksum) {
      const localChecksum = await sha256Text(localContent);
      if (localChecksum === lastServerChecksum) {
        return { shouldConflict: false, localState: { ...localState, content: localContent } };
      }
      return { shouldConflict: true, localState: { ...localState, content: localContent } };
    }

    // 存在 durable outbox 却缺少可信服务端基线时必须保守地保留本地版本。
    // 旧 v3 状态曾把本地 hash 写进 checksum，迁移后这种情况会刻意清空基线。
    if (pendingPayload) {
      return {
        shouldConflict: true,
        localState: { ...localState, content: localContent },
      };
    }

    // 没有 outbox 时退回到打开标签的 modified 标记。
    return {
      shouldConflict: !!localState.modified,
      localState: { ...localState, content: localContent },
    };
  }

  /**
   * 将远端文档应用到本地路径或 external 缓存区。
   */
  async applyRemoteDoc(doc, { force = false, expectedScope } = {}) {
    if (!doc?.fileId) return null;
    this.assertActiveScope(expectedScope);
    const deviceId = useDeviceStore.getState().getId();
    const syncStore = useSyncStore.getState();
    const editorStore = useEditorStore.getState();
    const existing = syncStore.getDoc(doc.fileId);
    const replica = syncStore.getReplica(doc.fileId);
    const serverPath = doc.deviceBindings?.[deviceId] || doc.devicePaths?.[deviceId] || '';
    // A locally newer bind/rename is authoritative until its outbox item is
    // acknowledged. A stopped enrollment deliberately ignores stale server paths.
    const myPath = replica?.linkState === 'linked'
      ? replica.localPath || existing?.localPath || serverPath
      : '';

    if (doc.deleted) {
      // 远端删除到达时，要先确认本地是否仍有未保存修改；若有，则升级为冲突，
      // 而不是直接把本地草稿视为“接受删除”。
      const deleteDecision = await this.getRemoteConflictDecision(doc.fileId, '', myPath, { force });
      this.assertActiveScope(expectedScope);
      if (deleteDecision.shouldConflict) {
        syncStore.recordConflict(
          doc.fileId,
          {
            rev: doc.rev || 0,
            lastKnownServerRev: doc.rev || 0,
            serverChecksum: doc.contentHash || doc.checksum || existing?.serverChecksum || '',
            deleted: true,
          },
          this.buildConflict(
            doc.fileId,
            doc,
            '',
            deleteDecision.localState.content,
            { localDeleted: deleteDecision.localDeleted },
          ),
        );
        return { conflict: true };
      }
      syncStore.cancelQueuedMutationsForFile(doc.fileId);
      syncStore.upsertDocumentAndReplica(
        doc.fileId,
        {
          rev: doc.rev || 0,
          lastKnownServerRev: doc.rev || 0,
          serverChecksum: doc.contentHash || doc.checksum || existing?.serverChecksum || '',
          localChecksum: '',
          status: 'deleted',
          enrolled: false,
          localPath: existing?.localPath || replica?.localPath || '',
          deleted: true,
        },
        replica ? {
          ...replica,
          linkState: 'unlinked',
          remoteDeleted: true,
          baseRev: doc.rev || 0,
          baseChecksum: doc.contentHash || doc.checksum || existing?.serverChecksum || '',
        } : null,
      );
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
      useExternalDocsStore.getState().remove(doc.fileId);
      return { deleted: true };
    }

    const decoded = await decodeAndVerifySyncBody(doc);
    this.assertActiveScope(expectedScope);

    if (syncStore.hasPendingContentMutation(doc.fileId) && !force) {
      // 若远端版本已经追上本地队列，先比对内容是否真的分叉；只有正文不同
      // 才进入冲突流程，否则直接用新的远端状态覆盖旧队列即可。
      const pendingDecision = await this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
      this.assertActiveScope(expectedScope);
      if (pendingDecision.shouldConflict) {
        syncStore.recordConflict(
          doc.fileId,
          {
            name: doc.fileName || basename(doc.originalPath || '') || doc.fileId,
            rev: doc.rev || existing?.rev || 0,
            lastKnownServerRev: doc.rev || existing?.lastKnownServerRev || 0,
            serverChecksum: doc.contentHash || doc.checksum || existing?.serverChecksum || '',
          },
          this.buildConflict(
            doc.fileId,
            doc,
            decoded,
            pendingDecision.localState.content,
            { localDeleted: pendingDecision.localDeleted },
          ),
        );
        return { conflict: true };
      }
      syncStore.dropContentMutationsForFile(doc.fileId);
    }

    if (myPath) {
      const openTab = editorStore.getTabByPath?.(myPath)
        || editorStore.tabs.find((tab) => tab.path === myPath);
      const localDecision = await this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
      this.assertActiveScope(expectedScope);
      if (localDecision.shouldConflict) {
        syncStore.recordConflict(
          doc.fileId,
          {
            localPath: myPath,
            name: doc.fileName || basename(myPath),
            ext: extOf(doc.fileName || basename(myPath)),
            rev: doc.rev || 0,
            lastKnownServerRev: doc.rev || 0,
            checksum: doc.contentHash || doc.checksum || '',
            serverChecksum: doc.contentHash || doc.checksum || '',
            deleted: false,
          },
          this.buildConflict(
            doc.fileId,
            doc,
            decoded,
            localDecision.localState.content || openTab?.content || '',
            { localDeleted: localDecision.localDeleted },
          ),
        );
        return { conflict: true };
      }

      let savedToBoundPath = false;
      try {
        const result = await saveFile(myPath, decoded, doc.encoding || 'UTF-8');
        savedToBoundPath = result?.success !== false;
      } catch {
        savedToBoundPath = false;
      }
      this.assertActiveScope(expectedScope);
      if (savedToBoundPath) {
        useFileIdStore.getState().bind(myPath, doc.fileId);
        const checksum = doc.contentHash || doc.checksum || '';
        syncStore.upsertDocumentAndReplica(
          doc.fileId,
          {
            localPath: myPath,
            name: doc.fileName || basename(myPath),
            ext: extOf(doc.fileName || basename(myPath)),
            encoding: doc.encoding || 'UTF-8',
            lineEnding: doc.lineEnding || 'LF',
            checksum,
            serverChecksum: checksum,
            localChecksum: checksum,
            rev: doc.rev || 0,
            lastKnownServerRev: doc.rev || 0,
            status: 'synced',
            deleted: false,
            enrolled: true,
          },
          {
            ...replica,
            deviceId,
            localPath: myPath,
            linkState: 'linked',
            baseRev: doc.rev || 0,
            baseChecksum: checksum,
            localChecksum: checksum,
            remoteDeleted: false,
          },
        );
        editorStore.replaceTabContentByPath(myPath, {
          name: doc.fileName || basename(myPath),
          content: decoded,
          encoding: doc.encoding || 'UTF-8',
          lineEnding: doc.lineEnding || 'LF',
        });
        useExternalDocsStore.getState().remove(doc.fileId);
        return { writtenPath: myPath, external: false };
      }
      if (!force) {
        syncStore.recordConflict(
          doc.fileId,
          {
            localPath: myPath,
            name: doc.fileName || basename(myPath),
            ext: extOf(doc.fileName || basename(myPath)),
            rev: doc.rev || 0,
            lastKnownServerRev: doc.rev || 0,
            serverChecksum: doc.contentHash || doc.checksum || '',
            deleted: false,
          },
          this.buildConflict(
            doc.fileId,
            doc,
            decoded,
            localDecision.localState.content || openTab?.content || '',
            { applyError: 'local_write_failed' },
          ),
        );
        return { conflict: true, applyError: 'local_write_failed' };
      }
      // The user explicitly chose the remote version, but the old binding is
      // unwritable. Preserve the verified body as a cloud document and stop
      // tracking that path so reconciliation cannot push stale disk contents.
      syncStore.upsertDocumentAndReplica(
        doc.fileId,
        { enrolled: false },
        replica ? { ...replica, linkState: 'unlinked' } : null,
      );
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
    }

    const externalDecision = await this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
    this.assertActiveScope(expectedScope);
    if (externalDecision.shouldConflict) {
      syncStore.recordConflict(
        doc.fileId,
        {
          name: doc.fileName || externalDecision.localState.tab?.name || doc.fileId,
          ext: extOf(doc.fileName || externalDecision.localState.tab?.name || ''),
          rev: doc.rev || 0,
          lastKnownServerRev: doc.rev || 0,
          checksum: doc.contentHash || doc.checksum || '',
          serverChecksum: doc.contentHash || doc.checksum || '',
          deleted: false,
        },
        this.buildConflict(
          doc.fileId,
          doc,
          decoded,
          externalDecision.localState.content || '',
          { localDeleted: externalDecision.localDeleted },
        ),
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
      serverChecksum: doc.contentHash || doc.checksum || '',
      localChecksum: doc.contentHash || doc.checksum || '',
      rev: doc.rev || 0,
      lastKnownServerRev: doc.rev || 0,
      status: 'synced',
      deleted: false,
      enrolled: false,
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

  /**
   * 确保 external 文档已在本地缓存中可读。
   */
  async ensureExternalDoc(fileId) {
    if (!fileId) return null;
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);
    const cached = useExternalDocsStore.getState().get(fileId);
    if (cached && typeof cached.content === 'string') return cached;
    try {
      const doc = await this.transport.getFile(fileId);
      this.assertActiveScope(expectedScope);
      if (!doc) return null;
      await this.applyRemoteDoc(doc, { expectedScope });
      return useExternalDocsStore.getState().get(fileId);
    } catch (err) {
      console.warn('[sync] ensureExternalDoc failed', fileId, err);
      return null;
    }
  }

  /**
   * 把 external 文档“认领”为本地路径对应的真实文件。
   */
  async claimExternalDoc(fileId, localPath, content, encoding = 'UTF-8') {
    if (!fileId || !localPath) return { ok: false };
    await this.bindLocalPath(fileId, localPath, {
      name: basename(localPath),
      ext: extOf(localPath),
      encoding,
    });
    useExternalDocsStore.getState().remove(fileId);

    return this.queueLocalUpsert(localPath, content, encoding, {
      name: basename(localPath),
      source: 'claim',
      linkReplica: true,
    });
  }

  /**
   * 兼容旧调用方的配置同步别名。
   *
   * @returns {Promise<object | undefined>} 配置同步结果
   */
  async syncSettings() {
    await this.syncConfig();
  }

  /**
   * 处理单条同步变更队列项。
   */
  async processMutation(item, expectedScope = item.ownerUserId) {
    const syncStore = useSyncStore.getState();
    const doc = syncStore.getDoc(item.fileId);
    try {
      this.assertActiveScope(expectedScope);

      if (item.type === 'upsert') {
        // baseRev belongs to this immutable operation. It must never be replaced
        // with a newer remote revision merely to make a stale write succeed.
        const data = await this.transport.putFile(item.fileId, {
          ...item.payload,
          baseRev: Number(item.baseRev || 0),
          mutationId: item.mutationId,
        });
        this.assertActiveScope(expectedScope);
        if (!syncStore.hasMutation(item.mutationId)) return { outcome: 'cancelled' };

        const serverRev = Number(data.rev ?? doc?.rev ?? 0);
        const serverChecksum = data.contentHash || data.checksum || item.payload.checksum;
        if (serverChecksum && serverChecksum !== item.payload.checksum) {
          throw new SyncIntegrityError('The server acknowledged a different document checksum', {
            expectedChecksum: item.payload.checksum,
            acknowledgedChecksum: serverChecksum,
          });
        }
        syncStore.completeMutation(item.mutationId);
        syncStore.rebasePendingMutations(item.fileId, serverRev);
        const stillPending = useSyncStore.getState().hasPendingMutation(item.fileId);
        const latestPendingPayload = useSyncStore.getState()
          .getPendingUpsertPayload(item.fileId);
        const currentReplica = useSyncStore.getState().getReplica(item.fileId);
        const remainsLinked = currentReplica?.linkState === 'linked';
        useSyncStore.getState().upsertDocumentAndReplica(item.fileId, {
          name: item.payload.fileName || doc?.name || item.fileId,
          ext: doc?.ext || extOf(item.payload.fileName || ''),
          localPath: currentReplica?.localPath || item.payload.devicePath || doc?.localPath || '',
          encoding: item.payload.encoding || doc?.encoding || 'UTF-8',
          lineEnding: item.payload.lineEnding || doc?.lineEnding || 'LF',
          checksum: serverChecksum,
          serverChecksum,
          localChecksum: latestPendingPayload?.checksum || item.payload.checksum,
          rev: serverRev,
          lastKnownServerRev: serverRev,
          status: stillPending ? 'pending_push' : 'synced',
          deleted: false,
          enrolled: remainsLinked,
          lastError: null,
        }, currentReplica ? {
          ...currentReplica,
          baseRev: serverRev,
          baseChecksum: serverChecksum,
          localChecksum: latestPendingPayload?.checksum || item.payload.checksum,
          remoteDeleted: false,
        } : null);
        if (!stillPending && !(item.payload.devicePath || doc?.localPath)) {
          useExternalDocsStore.getState().put(item.fileId, {
            name: item.payload.fileName || doc?.name || item.fileId,
            ext: doc?.ext || extOf(item.payload.fileName || ''),
            encoding: item.payload.encoding || doc?.encoding || 'UTF-8',
            lineEnding: item.payload.lineEnding || doc?.lineEnding || 'LF',
            originalPath: item.payload.originalPath || '',
            content: decodeSyncBody(item.payload),
            checksum: serverChecksum,
            rev: serverRev,
          });
        }
        return { outcome: 'success' };
      }

      if (item.type === 'bind_path') {
        const data = await this.transport.bindPath(item.fileId, {
          ...item.payload,
          mutationId: item.mutationId,
        });
        this.assertActiveScope(expectedScope);
        if (!syncStore.hasMutation(item.mutationId)) return { outcome: 'cancelled' };
        syncStore.completeMutation(item.mutationId);
        if (data) {
          const stillPending = useSyncStore.getState().hasPendingMutation(item.fileId);
          const currentReplica = syncStore.getReplica(item.fileId);
          const remainsLinked = currentReplica?.linkState === 'linked';
          syncStore.upsertDocumentAndReplica(item.fileId, {
            localPath: currentReplica?.localPath || item.payload.devicePath || doc?.localPath || '',
            enrolled: remainsLinked,
            status: remainsLinked
              ? stillPending ? doc?.status || 'idle' : 'synced'
              : 'stopped',
            lastKnownServerRev: Number(data.rev ?? doc?.lastKnownServerRev ?? 0),
          }, currentReplica ? {
            ...currentReplica,
            baseRev: Number(data.rev ?? currentReplica.baseRev ?? 0),
          } : null);
        }
        return { outcome: 'success' };
      }

      if (item.type === 'delete') {
        const data = await this.transport.deleteFile(item.fileId, {
          baseRev: Number(item.baseRev || 0),
          mutationId: item.mutationId,
        });
        this.assertActiveScope(expectedScope);
        if (!syncStore.hasMutation(item.mutationId)) return { outcome: 'cancelled' };
        const serverRev = Number(data.rev ?? doc?.rev ?? 0);
        syncStore.completeMutation(item.mutationId);
        syncStore.rebasePendingMutations(item.fileId, serverRev);
        const stillPending = useSyncStore.getState().hasPendingMutation(item.fileId);
        const currentReplica = useSyncStore.getState().getReplica(item.fileId);
        useSyncStore.getState().upsertDocumentAndReplica(
          item.fileId,
          {
            rev: serverRev,
            lastKnownServerRev: serverRev,
            localChecksum: '',
            status: stillPending ? 'pending_push' : 'deleted',
            enrolled: false,
            deleted: true,
          },
          currentReplica ? {
            ...currentReplica,
            linkState: 'unlinked',
            remoteDeleted: true,
            baseRev: serverRev,
          } : null,
        );
        useExternalDocsStore.getState().remove(item.fileId);
        return { outcome: 'success' };
      }

      const unsupported = new Error(`Unsupported sync mutation: ${item.type}`);
      unsupported.code = 'SYNC_PROTOCOL_ERROR';
      throw unsupported;
    } catch (err) {
      if (getCurrentUserScopeId() !== expectedScope || !useAuthStore.getState().isLoggedIn) {
        return { outcome: 'session_changed' };
      }

      if (err?.response?.status === 409) {
        const current = err.response?.data?.current;
        let remoteDoc = current;
        if (current?.fileId && !current.deleted && !Object.hasOwn(current, 'content')) {
          remoteDoc = await this.transport.getFile(current.fileId) || current;
        }
        this.assertActiveScope(expectedScope);
        const remoteContent = remoteDoc?.deleted || !remoteDoc
          ? ''
          : await decodeAndVerifySyncBody(remoteDoc);
        this.assertActiveScope(expectedScope);
        const localPath = item.payload?.devicePath || doc?.localPath || '';
        const localState = this.getOpenLocalState(item.fileId, localPath);
        const latestPayload = useSyncStore.getState().getPendingUpsertPayload(item.fileId);
        let queuedContent;
        try {
          queuedContent = latestPayload ? decodeSyncBody(latestPayload) : undefined;
        } catch {
          queuedContent = undefined;
        }
        const localContent = typeof queuedContent === 'string' ? queuedContent : localState.content;
        const diverged = localContent !== remoteContent;

        if (!diverged && remoteDoc) {
          useSyncStore.getState().dropMutationsForFile(item.fileId);
          await this.applyRemoteDoc(remoteDoc, { force: true, expectedScope });
          return { outcome: 'success' };
        }

        const conflictRemote = remoteDoc || {
          fileId: item.fileId,
          fileName: doc?.name || item.fileId,
          deleted: true,
          rev: 0,
        };
        useSyncStore.getState().recordConflict(
          item.fileId,
          {
            rev: Number(conflictRemote.rev ?? doc?.rev ?? 0),
            lastKnownServerRev: Number(conflictRemote.rev ?? doc?.lastKnownServerRev ?? 0),
            serverChecksum: conflictRemote.contentHash || conflictRemote.checksum || '',
            deleted: Boolean(conflictRemote.deleted),
          },
          this.buildConflict(
            item.fileId,
            conflictRemote,
            remoteContent,
            localContent,
            { localDeleted: item.type === 'delete' },
          ),
        );
        this.setStatus('conflict');
        return { outcome: 'conflict' };
      }

      const kind = classifyApiError(err);
      const message = err?.response?.data?.message || err?.message || 'sync failed';
      recordDiagnostic(`sync_${kind}`).catch(() => {});
      const retryAt = getMutationRetryAt({
        kind,
        retryCount: Number(item.retryCount || 0) + 1,
        error: err,
      });
      if (retryAt !== null) {
        useSyncStore.getState().retryMutation(item.mutationId, {
          retryAt,
          lastError: message,
          kind,
        });
      } else {
        useSyncStore.getState().blockMutation(item.mutationId, {
          lastError: message,
          kind,
        });
      }
      useSyncStore.getState().setLastSyncError({ kind, message, fileId: item.fileId });
      this.setStatus(kind === 'server_unreachable' ? 'server_unreachable' : kind);
      return { outcome: retryAt !== null ? 'retry' : 'blocked', kind };
    }
  }

  /**
   * 顺序消费当前所有可执行的同步队列项。
   */
  async processQueue(expectedScope = getCurrentUserScopeId()) {
    let blocked = false;
    while (true) {
      this.assertActiveScope(expectedScope);
      if (!useConfigStore.getState().syncEnabled) return { outcome: 'paused' };
      const item = useSyncStore.getState().claimReadyMutation();
      if (!item) break;
      await waitForSyncStatePersistence();
      const result = await this.processMutation(item, expectedScope);
      await waitForSyncStatePersistence();
      if (result.outcome === 'retry' || result.outcome === 'session_changed') return result;
      if (result.outcome === 'blocked' || result.outcome === 'conflict') blocked = true;
    }
    return { outcome: blocked ? 'blocked' : 'success' };
  }

  /**
   * 拉取远端增量变更并依次应用到本地。
   */
  async pullRemoteChanges(expectedScope = getCurrentUserScopeId()) {
    let checkpoint = useSyncStore.getState().getCheckpoint();
    let hasMore = true;
    while (hasMore) {
      this.assertActiveScope(expectedScope);
      const page = await this.transport.getChanges(checkpoint);
      this.assertActiveScope(expectedScope);
      const changes = page.changes.filter((change) => change?.fileId);
      const pending = changes.filter((change) => {
        const localDoc = useSyncStore.getState().getDoc(change.fileId);
        return !localDoc || (localDoc.lastKnownServerRev || 0) < (change.rev || 0);
      });
      let nextIndex = 0;
      let firstError = null;
      const workers = Array.from({ length: Math.min(PULL_WORKER_COUNT, pending.length) }, async () => {
        while (!firstError && nextIndex < pending.length) {
          const change = pending[nextIndex++];
          try {
            const fullDoc = change.deleted
              ? change
              : await this.transport.getFile(change.fileId);
            this.assertActiveScope(expectedScope);
            if (!fullDoc) {
              throw new SyncProtocolError('A changed document has no retrievable body', {
                fileId: change.fileId,
                rev: change.rev,
              });
            }
            await this.applyRemoteDoc(fullDoc, { expectedScope });
          } catch (error) {
            firstError ||= error;
          }
        }
      });
      await Promise.all(workers);
      // Successful items are persisted even if a sibling fetch failed. A retry
      // will skip their acknowledged revisions instead of replaying the page forever.
      await waitForSyncStatePersistence();
      if (firstError) throw firstError;

      this.assertActiveScope(expectedScope);
      useSyncStore.getState().setCheckpoint(page.checkpoint);
      await waitForSyncStatePersistence();
      checkpoint = page.checkpoint;
      hasMore = page.hasMore;
    }
    // Keep acknowledged tombstones locally. Their revision is the causal base
    // required for an explicit later restore of the same stable fileId.
  }

  /**
   * 手动把单个本地文件内容推入同步流程。
   */
  async pushSingle(filePath, content, encoding = 'UTF-8', source = 'manual') {
    return this.queueLocalUpsert(filePath, content, encoding, {
      name: basename(filePath),
      source,
    });
  }

  /** Link a local file to cloud sync on this device and queue its first snapshot. */
  async linkLocalDocument(filePath, content, encoding = 'UTF-8', options = {}) {
    return this.queueLocalUpsert(filePath, content, encoding, {
      ...options,
      source: options.source || 'bookmark-add',
      forceTracking: true,
      linkReplica: true,
    });
  }

  /**
   * Persist a non-runnable cloud tombstone before touching the local file.
   * The caller must either commit it after a successful filesystem delete or
   * abort it on failure. This closes the crash window without allowing a cloud
   * delete to race ahead of the local operation.
   */
  async prepareLocalDeletion(fileId) {
    if (!fileId || !useAuthStore.getState().isLoggedIn) {
      return { ok: false, reason: 'auth-required' };
    }
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);
    const syncStore = useSyncStore.getState();
    const doc = syncStore.getDoc(fileId);
    const replica = syncStore.getReplica(fileId);
    if (syncStore.listConflicts().some((item) => item.fileId === fileId)) {
      return { ok: true, conflict: true, previousDoc: doc, previousReplica: replica };
    }
    const mutationId = syncStore.enqueueMutation({
      fileId,
      type: 'delete',
      baseRev: doc?.lastKnownServerRev || doc?.rev || 0,
      dedupeKey: 'delete',
      payload: {},
      status: 'staged',
      errorKind: 'local_delete_pending',
      docPatch: {
        status: 'deleting_local',
        enrolled: false,
      },
    });
    if (!mutationId) return { ok: false, reason: 'conflict' };
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    return { ok: true, mutationId, previousDoc: doc, previousReplica: replica };
  }

  async commitLocalDeletion(prepared) {
    if (!prepared?.mutationId) return { ok: false, reason: 'not-staged' };
    const expectedScope = getCurrentUserScopeId();
    const activated = useSyncStore.getState().activateStagedMutation(
      prepared.mutationId,
      {
        status: 'pending_push',
        deleted: true,
        enrolled: false,
        localPath: '',
      },
      prepared.previousReplica ? {
        ...prepared.previousReplica,
        linkState: 'unlinked',
        remoteDeleted: true,
      } : null,
    );
    if (!activated) return { ok: false, reason: 'staged-delete-missing' };
    const item = useSyncStore.getState().listQueue()
      .find((candidate) => candidate.mutationId === prepared.mutationId);
    if (item?.fileId) useExternalDocsStore.getState().remove(item.fileId);
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    if (useConfigStore.getState().syncEnabled) this.fullSync();
    return { ok: true, mutationId: prepared.mutationId };
  }

  async abortLocalDeletion(prepared) {
    if (!prepared?.mutationId) return { ok: true };
    const expectedScope = getCurrentUserScopeId();
    const aborted = useSyncStore.getState().abortStagedMutation(
      prepared.mutationId,
      prepared.previousDoc,
      prepared.previousReplica,
    );
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    return { ok: aborted };
  }

  /**
   * 把文档标记为待删除，并生成删除 mutation。
   */
  async deleteDocument(fileId, options = {}) {
    if (!fileId) return { ok: false };
    if (!useAuthStore.getState().isLoggedIn) {
      return { ok: false, reason: 'auth-required' };
    }
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);
    const syncStore = useSyncStore.getState();
    const doc = syncStore.getDoc(fileId);
    if (syncStore.updateConflictLocal(
      fileId,
      '',
      { deleted: true, enrolled: false, localPath: '' },
      { localDeleted: true },
    )) {
      await waitForSyncStatePersistence();
      this.assertActiveScope(expectedScope);
      return { ok: true, conflict: true };
    }
    const mutationId = syncStore.enqueueMutation({
      fileId,
      type: 'delete',
      baseRev: doc?.lastKnownServerRev || doc?.rev || 0,
      dedupeKey: 'delete',
      payload: {},
      docPatch: {
        status: 'pending_push',
        deleted: true,
        enrolled: false,
        localPath: '',
      },
      replicaPatch: syncStore.getReplica(fileId) ? {
        ...syncStore.getReplica(fileId),
        linkState: 'unlinked',
        remoteDeleted: true,
      } : null,
    });
    if (!mutationId) return { ok: false, reason: 'conflict' };
    useExternalDocsStore.getState().remove(fileId);
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    if (!options.deferSync && useConfigStore.getState().syncEnabled) {
      this.fullSync();
    }
    return { ok: true, mutationId };
  }

  /**
   * 根据用户选择处理冲突。
   */
  async resolveConflict(fileId, resolution) {
    const expectedScope = getCurrentUserScopeId();
    await waitForSyncStoreHydration();
    this.assertActiveScope(expectedScope);
    const syncStore = useSyncStore.getState();
    const conflict = syncStore.listConflicts().find((item) => item.fileId === fileId);
    if (!conflict) return;
    if (resolution === 'remote') {
      syncStore.dropMutationsForFile(fileId);
      await this.applyRemoteDoc(conflict.remoteDoc, { force: true, expectedScope });
    } else if (resolution === 'local') {
      const doc = syncStore.getDoc(fileId);
      const replica = syncStore.getReplica(fileId);
      const localPath = replica?.linkState === 'linked'
        ? replica.localPath || doc?.localPath || ''
        : '';
      const content = conflict.localContent ?? '';
      let result;
      if (conflict.localDeleted) {
        const mutationId = syncStore.replaceConflictWithMutation({
          fileId,
          type: 'delete',
          baseRev: doc?.lastKnownServerRev || doc?.rev || 0,
          dedupeKey: 'delete',
          payload: {},
          docPatch: {
            status: 'pending_push',
            deleted: true,
            enrolled: false,
            localPath: '',
          },
        });
        if (!mutationId) return { ok: false, reason: 'conflict-state-changed' };
        await waitForSyncStatePersistence();
        this.assertActiveScope(expectedScope);
        result = { ok: true, queued: true };
      } else if (localPath) {
        result = await this.queueLocalUpsert(localPath, content, doc?.encoding || 'UTF-8', {
          name: doc?.name || basename(localPath),
          lineEnding: doc?.lineEnding || 'LF',
          source: 'conflict',
          deferSync: true,
          resolveConflict: true,
        });
      } else {
        // 纯云端文档没有本地路径，保留本地版本时需要把内容重新推回远端，
        // 否则用户选择的本地版本会在下一次同步时被远端覆盖。
        result = await this.queueExternalUpsert(fileId, content, doc?.encoding || 'UTF-8', {
          name: doc?.name || conflict.name || fileId,
          lineEnding: doc?.lineEnding || 'LF',
          source: 'conflict',
          deferSync: true,
          resolveConflict: true,
        });
      }
      if (!result?.ok) return result;
    } else {
      return { ok: false, reason: 'invalid-resolution' };
    }
    useSyncStore.getState().resolveConflict(fileId);
    await waitForSyncStatePersistence();
    this.assertActiveScope(expectedScope);
    const remainingConflicts = useSyncStore.getState().listConflicts().length;
    if (remainingConflicts === 0 && !useSyncStore.getState().listQueue().length) {
      this.setStatus('synced');
    } else if (useConfigStore.getState().syncEnabled) {
      this.fullSync();
    }
    return { ok: true };
  }

  /**
   * 同步配置镜像。
   *
   * 根据时间戳决定拉远端还是推本地，并复用协议检查与错误分类逻辑。
   */
  async syncConfig(options = {}) {
    const expectedScope = options.expectedScope || getCurrentUserScopeId();
    try {
      const remoteConfig = options.remoteConfig || await this.transport.getConfig();
      this.assertActiveScope(expectedScope);
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
        await this.transport.putConfig(payload);
        this.assertActiveScope(expectedScope);
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

  /**
   * Run one deterministic reconciliation cycle for a fixed account scope.
   */
  async runSyncCycle() {
    if (this.configSyncTimer) {
      clearTimeout(this.configSyncTimer);
      this.configSyncTimer = null;
    }
    await this.ensureLocalReset();
    const expectedScope = getCurrentUserScopeId();
    this.assertActiveScope(expectedScope);
    this.setStatus('syncing');

    let configError = null;
    try {
      await this.syncConfig({ expectedScope });
    } catch (error) {
      if (error?.code === 'SYNC_SESSION_CHANGED') throw error;
      configError = error;
    }

    // Rebuild the durable dirty set before accepting remote writes, then pull
    // first so concurrent remote changes become explicit conflicts rather than
    // avoidable 409 responses.
    await this.reconcileLocalBookmarks(expectedScope);
    if (!useConfigStore.getState().syncEnabled) return { outcome: 'paused' };
    await this.pullRemoteChanges(expectedScope);
    if (!useConfigStore.getState().syncEnabled) return { outcome: 'paused' };
    const queueResult = await this.processQueue(expectedScope);
    if (queueResult.outcome === 'paused') return queueResult;
    if (queueResult.outcome !== 'retry' && queueResult.outcome !== 'session_changed') {
      await this.pullRemoteChanges(expectedScope);
    }
    this.assertActiveScope(expectedScope);

    const syncStore = useSyncStore.getState();
    const conflicts = syncStore.listConflicts();
    const queue = syncStore.listQueue();
    const blocked = queue.some((item) => item.status === 'blocked' && item.errorKind !== 'conflict');
    if (conflicts.length > 0) {
      this.setStatus('conflict');
      return { outcome: 'conflict' };
    }
    if (blocked || configError) {
      const error = configError || new Error('One or more changes require manual retry');
      const kind = configError ? classifyApiError(configError) : 'request_error';
      syncStore.setLastSyncError({
        kind,
        message: error?.response?.data?.message || error?.message || 'sync blocked',
      });
      this.setStatus(kind);
      if (configError && this.shouldRetry(kind)) {
        this.runRetryCount = Number(this.runRetryCount || 0) + 1;
        const retryAt = getMutationRetryAt({
          kind,
          retryCount: this.runRetryCount,
          error: configError,
        });
        if (retryAt !== null) this.scheduleRetry(retryAt);
      }
      return { outcome: 'blocked', error, kind };
    }
    if (queue.length > 0) {
      this.scheduleRetry();
      const lastKind = syncStore.getLastSyncError()?.kind;
      this.setStatus(lastKind || 'idle');
      return { outcome: 'retry' };
    }

    syncStore.markSyncSuccessful();
    await waitForSyncStatePersistence();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setStatus('synced');
    this.runRetryCount = 0;
    this.lastErrorNotification = '';
    return { outcome: 'success' };
  }

  notifySyncError(kind, error) {
    const message = error?.response?.data?.message || String(error?.message || error);
    const signature = `${kind}:${message}`;
    if (signature === this.lastErrorNotification) return;
    this.lastErrorNotification = signature;
    useNotificationStore.getState().notify(
      'error',
      i18n.t('notification.syncFailed'),
      message,
    );
  }

  async drainSyncRequests() {
    this.syncing = true;
    let result = { outcome: 'skipped' };
    try {
      while (
        this.syncRequested
        && useAuthStore.getState().isLoggedIn
        && useConfigStore.getState().syncEnabled
      ) {
        this.syncRequested = false;
        try {
          result = await this.runSyncCycle();
          if (result.outcome === 'retry') break;
        } catch (err) {
          if (err?.code === 'SYNC_SESSION_CHANGED') {
            result = { outcome: 'session_changed' };
            break;
          }
          const kind = classifyApiError(err);
          const message = err?.response?.data?.message || err?.message || 'sync failed';
          useSyncStore.getState().setLastSyncError({ kind, message });
          this.setStatus(kind === 'server_unreachable' ? 'server_unreachable' : kind);
          this.notifySyncError(kind, err);
          if (this.shouldRetry(kind)) {
            this.runRetryCount = Number(this.runRetryCount || 0) + 1;
            const retryAt = getMutationRetryAt({
              kind,
              retryCount: this.runRetryCount,
              error: err,
            });
            if (retryAt !== null) this.scheduleRetry(retryAt);
          }
          result = { outcome: 'error', kind, error: err };
          break;
        }
      }
    } finally {
      this.syncing = false;
    }
    return result;
  }

  /**
   * Coalesce concurrent callers into one promise while guaranteeing that a
   * request arriving mid-cycle schedules another complete reconciliation pass.
   */
  fullSync() {
    if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) {
      return Promise.resolve({ outcome: 'skipped' });
    }
    this.syncRequested = true;
    if (!this.syncPromise) {
      this.syncPromise = this.drainSyncRequests().finally(() => {
        this.syncPromise = null;
      });
    }
    return this.syncPromise;
  }

  retryNow() {
    useSyncStore.getState().retryBlockedMutations();
    return this.fullSync();
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
