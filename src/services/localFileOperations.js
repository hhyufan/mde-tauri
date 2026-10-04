import useEditorStore from '@store/useEditorStore';
import { getBuffer } from '@utils/editorBuffer';
import { readFileContent, saveFile } from '@utils/tauriApi';
import { classifyFileVersions, getDiskBaseline, rememberDiskBaseline, withFileOperation } from './localFileGuard';

let inputComposing = false;
export function setLocalFileComposing(composing) {
  inputComposing = composing;
}

// Call only while holding the path's operation queue. Read editor state AFTER IO;
// neither a captured Zustand state nor a watcher event is a disk snapshot.
async function inspectFile(path, isCurrent = () => true) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const baseline = getDiskBaseline(path);
    const disk = await readFileContent(path).catch(() => null);
    if (!isCurrent()) return null;
    if (baseline !== getDiskBaseline(path)) continue;
    const state = useEditorStore.getState();
    const tab = state.tabs.find((item) => item.path === path);
    if (!tab) return null;
    const editorContent = getBuffer(tab.id, tab.content || '');
    const diskContent = disk?.content || '';
    return {
      state, tab, disk, editorContent, diskContent,
      outcome: disk?.success ? classifyFileVersions({
        baseContent: baseline?.content ?? tab.content ?? '', editorContent, diskContent,
      }) : 'unavailable',
    };
  }
  return null;
}

function clearConflict(path) {
  const state = useEditorStore.getState();
  if (state.externalFileConflict?.path === path) state.clearExternalFileConflict();
}

function reportConflict(path, version) {
  const { state, tab, disk, diskContent } = version;
  const conflict = state.externalFileConflict;
  const kind = disk?.success ? 'modified' : 'removed';
  if (conflict?.path === path && conflict.kind === kind && conflict.diskContent === disk?.content) return;
  state.setExternalFileConflict({
    path, tabId: tab.id, kind,
    ...(disk?.success ? { diskContent, encoding: disk.encoding || tab.encoding,
      lineEnding: disk.line_ending || tab.lineEnding } : {}),
  });
}

function reloadExternal(path, version) {
  const { state, tab, disk, diskContent } = version;
  state.replaceTabContentByPath(path, {
    content: diskContent, encoding: disk.encoding || tab.encoding,
    lineEnding: disk.line_ending || tab.lineEnding,
  });
  rememberDiskBaseline(path, diskContent);
  clearConflict(path);
}

/** Compare and save as one operation; queued autosaves use the current buffer. */
export function saveExistingFile(path, _content, encoding, _tabId) {
  return withFileOperation(path, async () => {
    if (inputComposing) return { success: false, superseded: true };
    const version = await inspectFile(path, () => !inputComposing);
    if (!version) return { success: false, superseded: true };
    const { state, tab, outcome, editorContent, diskContent } = version;
    if (outcome === 'conflict' || outcome === 'unavailable') {
      reportConflict(path, version);
      return { success: false, conflict: true };
    }
    if (outcome === 'external-only') {
      reloadExternal(path, version);
      return { success: false, externalReloaded: true };
    }
    const result = outcome === 'converged' || editorContent === diskContent
      ? { success: true, converged: true, file_path: path }
      : await saveFile(path, editorContent, encoding, { operationHeld: true });
    if (result?.success) {
      rememberDiskBaseline(path, editorContent);
      state.markTabSaved(tab.id, editorContent);
      clearConflict(path);
    }
    return { ...result, savedContent: editorContent };
  });
}

export function reconcileFileChange(path, { isCurrent, confirmMissing = false } = {}) {
  return withFileOperation(path, async () => {
    const version = await inspectFile(path, isCurrent);
    if (!version) return 'superseded';
    const { state, tab, outcome, diskContent } = version;
    if (outcome === 'unavailable') {
      if (confirmMissing) reportConflict(path, version);
      return outcome;
    }
    if (outcome === 'conflict') reportConflict(path, version);
    else if (outcome === 'external-only') reloadExternal(path, version);
    else {
      rememberDiskBaseline(path, diskContent);
      if (version.editorContent === diskContent) state.markTabSaved(tab.id, diskContent);
      clearConflict(path);
    }
    return outcome;
  });
}

/** Coalesce atomic replace events; confirm missing files after the replace gap. */
export function createFileChangeObserver({ delay = 300, isComposing = () => false, onError = console.warn } = {}) {
  const pending = new Map();
  let disposed = false;
  const schedule = (event) => {
    if (disposed || !event?.path) return;
    const previous = pending.get(event.path);
    if (previous) clearTimeout(previous.timer);
    const entry = {};
    pending.set(event.path, entry);
    const isCurrent = () => !disposed && pending.get(event.path) === entry;
    const check = async (confirmMissing = false) => {
      if (!isCurrent()) return;
      if (isComposing()) {
        entry.timer = setTimeout(() => check(confirmMissing), delay);
        return;
      }
      try {
        const outcome = await reconcileFileChange(event.path, {
          isCurrent: () => isCurrent() && !isComposing(), confirmMissing,
        });
        if (!isCurrent()) return;
        if (outcome === 'superseded' && isComposing()) {
          entry.timer = setTimeout(() => check(confirmMissing), delay);
        } else if (outcome === 'unavailable' && !confirmMissing) {
          entry.timer = setTimeout(() => check(true), delay);
        } else pending.delete(event.path);
      } catch (error) {
        if (isCurrent()) pending.delete(event.path);
        onError(error);
      }
    };
    entry.timer = setTimeout(() => check(), delay);
  };
  schedule.dispose = () => {
    disposed = true;
    pending.forEach((entry) => clearTimeout(entry.timer));
    pending.clear();
  };
  return schedule;
}
