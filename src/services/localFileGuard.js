/**
 * Local working-copy guard.
 *
 * A filesystem watcher event is only a hint. Conflict decisions are made from
 * three text versions: the last disk snapshot observed by this process, the
 * current editor buffer, and the current disk contents.
 */

const diskBaselines = new Map();
const fileOperations = new Map();

/** Serialize disk reads and writes for a path across every editor/hook instance. */
export function withFileOperation(path, operation) {
  const previous = fileOperations.get(path) || Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  const settled = result.then(() => {}, () => {});
  fileOperations.set(path, settled);
  settled.then(() => {
    if (fileOperations.get(path) === settled) fileOperations.delete(path);
  });
  return result;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Normalize desktop, watcher and Android metadata into one shape. */
export function normalizeFileMetadata(metadata = {}) {
  const preciseModified = metadata.modifiedMs
    ?? metadata.modified_ms
    ?? metadata.modifiedAt
    ?? metadata.modified_at;
  const legacySeconds = metadata.modified;
  return {
    modifiedAt: preciseModified != null
      ? finiteNumber(preciseModified)
      : finiteNumber(legacySeconds) * 1000,
    size: finiteNumber(metadata.size),
  };
}

/** Remember a disk version after open, reload, acknowledgement or save. */
export function rememberDiskBaseline(path, content, metadata = {}) {
  if (!path || typeof content !== 'string') return null;
  const snapshot = {
    path,
    content,
    ...normalizeFileMetadata(metadata),
  };
  diskBaselines.set(path, snapshot);
  return snapshot;
}

export function getDiskBaseline(path) {
  return path ? diskBaselines.get(path) || null : null;
}

export function forgetDiskBaseline(path) {
  if (path) diskBaselines.delete(path);
}

export function moveDiskBaseline(oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const current = diskBaselines.get(oldPath);
  diskBaselines.delete(oldPath);
  if (current) diskBaselines.set(newPath, { ...current, path: newPath });
}

/**
 * Metadata is a fast gate only. A changed result must be confirmed by reading
 * and comparing actual text before it can become a conflict.
 */
export function metadataMatchesBaseline(path, metadata = {}) {
  const baseline = getDiskBaseline(path);
  if (!baseline) return false;
  const current = normalizeFileMetadata(metadata);
  if (!baseline.modifiedAt || !current.modifiedAt) return false;
  return baseline.modifiedAt === current.modifiedAt && baseline.size === current.size;
}

/**
 * Classify the three-way relationship between base, editor and disk.
 *
 * - unchanged: only metadata changed, or this is our own watcher event
 * - converged: editor and disk independently reached the same text
 * - external-only: disk changed while the editor still equals the base
 * - conflict: editor and disk both diverged from the base and differ
 */
export function classifyFileVersions({ baseContent, editorContent, diskContent }) {
  const base = typeof baseContent === 'string' ? baseContent : '';
  const editor = typeof editorContent === 'string' ? editorContent : '';
  const disk = typeof diskContent === 'string' ? diskContent : '';

  if (disk === base) return 'unchanged';
  if (disk === editor) return 'converged';
  if (editor === base) return 'external-only';
  return 'conflict';
}

/** Test/reset helper; baselines are process-local and never persisted. */
export function clearDiskBaselines() {
  diskBaselines.clear();
}

