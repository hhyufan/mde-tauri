import useEditorStore from '@store/useEditorStore';
import useProblemsStore, { problemPathKey } from '@store/useProblemsStore';

let latestRequest = 0;
let latestTarget;
export async function jumpToProblem(problem, openFileFromPath) {
  const request = ++latestRequest;
  const findTab = () => useEditorStore.getState().tabs.find((tab) => tab.id === problem.tabId
    || Boolean(tab.path && problem.filePath && problemPathKey(tab.path) === problemPathKey(problem.filePath)));
  let tab = findTab();
  if (!tab && problem.filePath) {
    await openFileFromPath(problem.filePath, problem.fileName || problem.filePath.split(/[\\/]/).pop());
    tab = findTab();
  }
  if (request !== latestRequest) {
    if (latestTarget) {
      useEditorStore.getState().setActiveTab(latestTarget.tabId);
      useProblemsStore.getState().requestJump(latestTarget);
    }
    return true;
  }
  if (!tab) return false;
  useEditorStore.getState().setActiveTab(tab.id);
  useEditorStore.getState().setViewMode('edit');
  latestTarget = { tabId: tab.id, range: problem.range };
  useProblemsStore.getState().requestJump(latestTarget);
  return true;
}
