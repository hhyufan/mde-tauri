import { useEffect, useMemo, useState } from 'react';
import useFileStore from '@store/useFileStore';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import { getBuffer, subscribe } from '@utils/editorBuffer';
import { cancelSearch, searchFiles } from '@utils/tauriApi';
import { contentSearchResults, fileSearchScore, isInSearchRoot, relativeSearchPath, searchPathKey } from '@utils/searchMatching';

export default function useWorkspaceSearch({ open, query, mode, scope, caseSensitive, includeExcluded }) {
  const currentDir = useFileStore((s) => s.currentDir);
  const firstDir = useFileStore((s) => s.dirHistory[0]);
  const recentFiles = useFileStore((s) => s.recentFiles);
  const workspace = useConfigStore((s) => s.workspacePath);
  const tabs = useEditorStore((s) => s.tabRenderList);
  const revision = useEditorStore((s) => s.tabsRevision);
  const [bufferRevision, setBufferRevision] = useState(0);
  const [state, setState] = useState({ results: [], loading: false, error: '', truncated: false, skippedFiles: 0 });
  const projectRoot = workspace || firstDir || currentDir;
  const root = scope === 'folder' ? currentDir : scope === 'open' ? '' : projectRoot;
  const effectiveScope = root || scope === 'open' ? scope : 'open';
  const trimmed = query.trim();
  useEffect(() => {
    if (!open || mode !== 'content') return undefined;
    return subscribe(() => setBufferRevision((version) => version + 1));
  }, [open, mode]);
  const candidates = useMemo(() => {
    const relevantTabs = tabs.filter((tab) => effectiveScope === 'open' || isInSearchRoot(tab.path, root));
    const known = new Set(relevantTabs.map((tab) => searchPathKey(tab.path) || tab.id));
    const suggestions = relevantTabs.map((tab) => ({ name: tab.name, path: tab.path, tabId: tab.id, source: 'open', modified: tab.modified }));
    if (effectiveScope !== 'open' || !trimmed) {
      for (const file of recentFiles) {
        const key = searchPathKey(file.path);
        if (!key || known.has(key) || (root && !isInSearchRoot(file.path, root))) continue;
        known.add(key); suggestions.push({ name: file.name, path: file.path, source: 'recent' });
      }
    }
    return { relevantTabs, suggestions };
  }, [tabs, effectiveScope, root, recentFiles, trimmed]);

  useEffect(() => {
    if (!open) return undefined;
    let disposed = false, taskId;
    if (!trimmed) {
      setState({ results: candidates.suggestions.slice(0, 20), loading: false, error: '', truncated: false, skippedFiles: 0 });
      return undefined;
    }
    const local = mode === 'content'
      ? candidates.relevantTabs.flatMap((tab) => contentSearchResults(tab, getBuffer(tab.id), trimmed, caseSensitive))
      : candidates.suggestions.flatMap((item) => {
        const score = fileSearchScore(item.name, relativeSearchPath(item.path, root), trimmed, caseSensitive);
        return score === null ? [] : [{ ...item, score }];
      });
    const sort = (items) => mode === 'files' ? items.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)) : items;
    setState({ results: sort(local).slice(0, 100), loading: effectiveScope !== 'open', error: '', truncated: local.length > 100, skippedFiles: 0 });
    if (effectiveScope === 'open') return undefined;
    const timer = setTimeout(async () => {
      taskId = crypto.randomUUID();
      try {
        const response = await searchFiles(root, trimmed, mode === 'content', 100, taskId, { caseSensitive, includeExcluded });
        if (disposed) return;
        const disk = Array.isArray(response) ? response : response.results;
        // 已打开文件的内容以编辑缓冲为准，移除磁盘旧内容的命中。
        const ownedPaths = new Set((mode === 'content' ? candidates.relevantTabs : local).map((item) => searchPathKey(item.path)));
        const combined = sort([...local, ...disk.filter((item) => !ownedPaths.has(searchPathKey(item.path))).map((item) => ({ ...item, source: 'disk' }))]);
        setState({ results: combined.slice(0, 100), loading: false, error: '', truncated: Boolean(response.truncated || combined.length > 100), skippedFiles: response.skippedFiles || 0 });
      } catch (error) {
        if (!disposed) setState({ results: sort(local).slice(0, 100), loading: false, error: String(error), truncated: local.length > 100, skippedFiles: 0 });
      } finally { taskId = null; }
    }, 180);
    return () => { disposed = true; clearTimeout(timer); if (taskId) cancelSearch(taskId).catch(() => {}); };
  }, [open, trimmed, mode, effectiveScope, root, caseSensitive, includeExcluded, candidates, revision, bufferRevision]);
  return { ...state, results: open ? state.results : [], loading: open && state.loading, root, projectRoot, currentDir, effectiveScope };
}
