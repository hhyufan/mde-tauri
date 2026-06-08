/**
 * 云同步引擎入口。
 *
 * 本文件统一封装本地文件、external 文档缓存、配置镜像以及远端同步协议之间的
 * 协作流程，对外提供入队、拉取、冲突处理、路径绑定与配置同步等核心能力。
 */
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
import i18n from '@/i18n';

// 小体积内容直接明文上传，避免不必要的 gzip 开销。
const COMPRESS_THRESHOLD_BYTES = 16 * 1024;
// 预留服务端请求体上限安全余量（避免触发平台硬限制）。
const MAX_REQUEST_BYTES = 3.5 * 1024 * 1024;
const CONFIG_SYNC_DEBOUNCE_MS = 900;
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * 计算文本 SHA-256，用于内容去重与远端校验。
 */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', textEncoder.encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 把二进制内容编码成 base64，便于放入 JSON 请求体。
 */
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

/**
 * 将 base64 恢复为二进制数组。
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
 * 把原始文本编码为可上传的同步载荷。
 *
 * 小文件直接明文传输，大文件则 gzip 后转为 base64，以在网络体积和 CPU 成本
 * 之间取得平衡。
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

/**
 * 还原服务端返回的文档正文。
 */
function decodeBody(doc) {
  if (!doc.compressed) return doc.content || '';
  const bytes = base64ToBytes(doc.content || '');
  const inflated = pako.ungzip(bytes);
  return textDecoder.decode(inflated);
}

/**
 * 生成一次变更提交使用的唯一 mutationId。
 */
function mutationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
class SyncEngine {
  constructor() {
    this.status = 'idle';
    this.listeners = new Set();
    this.retryTimer = null;
    this.syncing = false;
    this.syncPending = false;
    this.configSyncTimer = null;
    this.suppressConfigAutoSync = false;
    this.setupConfigSubscriptions();
  }

  /**
   * 订阅会影响“云端配置镜像”的本地 store。
   *
   * 这些状态虽然分散在多个 store 中，但从同步视角看都属于同一份用户配置，
   * 所以在引擎层集中节流并上推。
   */
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

  /**
   * 节流触发配置同步，避免短时间内多个 store 连续变更造成重复请求。
   */
  scheduleConfigSync() {
    if (this.suppressConfigAutoSync || this.syncing) return;
    if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) return;
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
      applySettingsSnapshot(remoteConfig);
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

  /**
   * 判断当前错误类型是否值得自动重试。
   *
   * @param {string} kind 分类后的同步错误类型
   * @returns {boolean} 是否进入重试流程
   */
  shouldRetry(kind) {
    return ['offline', 'server_unreachable', 'server_error', 'error'].includes(kind);
  }

  /**
   * 在账号切换后的首次同步前，清理当前用户作用域下的云端镜像状态。
   */
  async ensureLocalReset() {
    const syncStore = useSyncStore.getState();
    if (syncStore.isLocalResetDone()) return;
    // 切换账号后只清理当前作用域的云同步镜像，不碰其他本地 UI 状态，
    // 避免跨账号残留的云文档/队列污染新会话。
    useExternalDocsStore.getState().resetCurrentUser();
    useFileStore.getState().removeCloudBookmarks();
    useFileIdStore.getState().resetCurrentUser();
    syncStore.resetDocumentsAndQueue();
    syncStore.markLocalResetDone();
  }

  /**
   * 确保远端同步协议版本可用；必要时触发服务端重置并重建配置镜像。
   */
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

  /**
   * 在同步层登记一个本地文档，并确保其与 `fileId` 绑定。
   */
  registerLocalDocument(filePath, meta = {}) {
    if (!filePath || isCloudPath(filePath)) return null;
    const fileIdStore = useFileIdStore.getState();
    const existingFileId = fileIdStore.idOf(filePath);
    const isBookmarked = useFileStore.getState().isBookmarked(filePath);

    // 只有“已收藏”或调用方显式提供了 `fileId` 时，才会为本地路径建立云身份。
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

    const existingFileId = useFileIdStore.getState().idOf(filePath);
    const isBookmarked = useFileStore.getState().isBookmarked(filePath);

    // 本地文件只有在“已收藏”或“已经绑定过云端 fileId”时才进入云同步。
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
    // 同一文件在队列中只保留一条去重后的 upsert，后续编辑会覆盖旧载荷，
    // 从而确保真正出队的始终是最新内容快照。
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

  /**
   * 记录“该云文档在当前设备对应哪个本地路径”。
   *
   * 这类绑定会同步到服务端，供跨设备回填相同文档的本地落点与冲突判断。
   */
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

  /**
   * 构造统一格式的冲突对象，供冲突面板直接消费。
   */
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
    const doc = useSyncStore.getState().getDoc(fileId);

    // 本地“权威内容”优先取同步队列里待推送的内容；否则取编辑器里打开的实时内容
    // （getOpenLocalState 已合并 editorBuffer）。自动保存会在推送后立刻清掉 modified
    // 标记，所以不能只看 modified，必须以真实内容做比对。
    const pendingContent = useSyncStore.getState().getPendingUpsertContent?.(fileId);
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
    const lastServerChecksum = doc?.checksum || '';
    if (lastServerChecksum) {
      const localChecksum = await sha256(localContent);
      if (localChecksum === lastServerChecksum) {
        return { shouldConflict: false, localState: { ...localState, content: localContent } };
      }
      return { shouldConflict: true, localState: { ...localState, content: localContent } };
    }

    // 缺少可比对的服务端基线校验和时，退回到“标签已被修改”作为兜底，避免在
    // 信息不足时把正常拉取误判为冲突。
    return {
      shouldConflict: !!localState.modified,
      localState: { ...localState, content: localContent },
    };
  }

  /**
   * 将远端文档应用到本地路径或 external 缓存区。
   */
  async applyRemoteDoc(doc, { force = false } = {}) {
    if (!doc?.fileId) return null;
    const deviceId = useDeviceStore.getState().getId();
    const myPath = doc.deviceBindings?.[deviceId] || '';
    const syncStore = useSyncStore.getState();
    const editorStore = useEditorStore.getState();
    const existing = syncStore.getDoc(doc.fileId);

    if (doc.deleted) {
      // 远端删除到达时，要先确认本地是否仍有未保存修改；若有，则升级为冲突，
      // 而不是直接把本地草稿视为“接受删除”。
      const deleteDecision = await this.getRemoteConflictDecision(doc.fileId, '', myPath, { force });
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
      // 若远端版本已经追上本地队列，先比对内容是否真的分叉；只有正文不同
      // 才进入冲突流程，否则直接用新的远端状态覆盖旧队列即可。
      const pendingDecision = await this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
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
      const localDecision = await this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
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
        // 本地落盘失败时，继续退回 external 形式承载远端文档。
      }
    }

    const externalDecision = await this.getRemoteConflictDecision(doc.fileId, decoded, myPath, { force });
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

  /**
   * 确保 external 文档已在本地缓存中可读。
   */
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

    if (!useFileStore.getState().isBookmarked(localPath)) {
      useFileStore.getState().toggleBookmark(localPath);
    }

    return this.queueLocalUpsert(localPath, content, encoding, {
      name: basename(localPath),
      source: 'claim',
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
        // 推送被拒说明本地基于过期版本改动，而远端已被其它设备抢先更新。直接以
        // “本次尝试推送的内容”作为本地权威内容来判断是否真的分叉，不依赖标签的
        // modified 标记（自动保存会在排队后立刻清除它，导致漏判冲突）。
        const localState = this.getOpenLocalState(item.fileId, localPath);
        const localContent = typeof item.payload?.rawContent === 'string'
          ? item.payload.rawContent
          : localState.content;
        const diverged = localContent !== (remoteContent || '');
        useSyncStore.getState().completeMutation(item.mutationId);
        if (!diverged) {
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
            localContent,
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

  /**
   * 顺序消费当前所有可执行的同步队列项。
   */
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

  /**
   * 拉取远端增量变更并依次应用到本地。
   */
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

  /**
   * 手动把单个本地文件内容推入同步流程。
   */
  async pushSingle(filePath, content, encoding = 'UTF-8', source = 'manual') {
    return this.queueLocalUpsert(filePath, content, encoding, {
      name: basename(filePath),
      source,
    });
  }

  /**
   * 把文档标记为待删除，并生成删除 mutation。
   */
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

  /**
   * 根据用户选择处理冲突。
   */
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
      } else {
        // 纯云端文档没有本地路径，保留本地版本时需要把内容重新推回远端，
        // 否则用户选择的本地版本会在下一次同步时被远端覆盖。
        await this.queueExternalUpsert(fileId, content, doc?.encoding || 'UTF-8', {
          name: doc?.name || conflict.name || fileId,
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

  /**
   * 同步配置镜像。
   *
   * 根据时间戳决定拉远端还是推本地，并复用协议检查与错误分类逻辑。
   */
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

  /**
   * 执行完整同步流程。
   *
   * 顺序为：本地准备 -> 协议检查 -> 配置对齐 -> 推送队列 -> 拉取远端 -> 再次
   * 对齐配置。这样能最大程度保留本地最新编辑意图，并减少旧快照回写。
   */
  async fullSync() {
    if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) {
      return;
    }
    // 同步进行中时，记下“还有新变更要推”，等当前轮结束后再补跑一轮，避免在
    // 一次 fullSync 飞行途中入队的 mutation（例如认领云端文档时的 bind/upsert）
    // 被这条 guard 静默吞掉，造成“已落盘但没推到云”。
    if (this.syncing) {
      this.syncPending = true;
      return;
    }
    this.syncing = true;
    this.setStatus('syncing');
    try {
      // 统一采用“先推队列，再拉远端，再对齐配置”的顺序。
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
        i18n.t('notification.syncFailed'),
        err?.response?.data?.message || String(err?.message || err),
      );
      if (this.shouldRetry(kind)) {
        this.scheduleRetry();
      }
    } finally {
      this.syncing = false;
      if (this.syncPending) {
        this.syncPending = false;
        // 用微任务补跑，确保上一轮的 finally 完整结束、syncing 已复位。
        Promise.resolve().then(() => this.fullSync());
      }
    }
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
