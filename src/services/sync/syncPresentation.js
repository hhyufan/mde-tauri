import { isOwnedByUser, normalizeOwnerUserId } from '@store/userScope';

const ACTIVE_MUTATION_STATUSES = new Set(['staged', 'pending', 'processing', 'blocked']);
const ERROR_DOCUMENT_STATUSES = new Set(['error', 'apply_error']);

/**
 * Resolve the footer status with session/config state taking precedence over
 * the last engine event. A signed-out client is deliberately shown as offline
 * instead of removing the status control from the footer.
 */
export function resolveGlobalSyncStatus({
  isLoggedIn,
  syncEnabled,
  conflictCount = 0,
  blockedCount = 0,
  pendingCount = 0,
  engineStatus = 'idle',
}) {
  if (!isLoggedIn) return 'offline';
  if (!syncEnabled) return 'disabled';
  if (conflictCount > 0) return 'conflict';
  if (blockedCount > 0 && ['idle', 'synced'].includes(engineStatus)) return 'error';
  if (pendingCount > 0 && ['idle', 'synced'].includes(engineStatus)) return 'pending';
  return engineStatus;
}

/**
 * Describe the cloud state of one local Explorer file from persisted store
 * snapshots. Returning null means the path is not currently enrolled.
 */
export function getExplorerFileSyncState({
  filePath,
  ownerUserId,
  pathToId = {},
  docs = {},
  replicas = {},
  queue = [],
  conflicts = [],
}) {
  if (!filePath) return null;
  const owner = normalizeOwnerUserId(ownerUserId);
  const mappedFileId = pathToId[`${owner}::path::${filePath}`];
  const replica = (mappedFileId && replicas[`${owner}::${mappedFileId}`])
    || Object.values(replicas).find((item) =>
      item?.localPath === filePath && isOwnedByUser(item?.ownerUserId, owner)
    );
  if (!replica || replica.linkState !== 'linked') return null;
  const fileId = replica.fileId || mappedFileId;
  if (!fileId) return null;

  const doc = docs[`${owner}::${fileId}`]
    || Object.values(docs).find((item) =>
      item?.fileId === fileId && isOwnedByUser(item?.ownerUserId, owner)
    );
  if (!doc || doc.deleted) return null;

  const hasConflict = conflicts.some((item) =>
    item?.fileId === fileId && isOwnedByUser(item?.ownerUserId, owner)
  );
  if (hasConflict) return { fileId, status: 'conflict' };

  const mutations = queue.filter((item) =>
    item?.fileId === fileId
    && isOwnedByUser(item?.ownerUserId, owner)
    && ACTIVE_MUTATION_STATUSES.has(item?.status)
  );
  if (mutations.some((item) => item.status === 'blocked')) {
    return { fileId, status: 'error' };
  }
  if (mutations.length > 0 || doc.status === 'pending_push') {
    return { fileId, status: 'pending' };
  }
  if (ERROR_DOCUMENT_STATUSES.has(doc.status)) {
    return { fileId, status: 'error' };
  }
  return { fileId, status: 'synced' };
}
