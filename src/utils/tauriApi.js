import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const appWindow = getCurrentWindow();

export async function readFileContent(path) {
  return invoke('read_file_content', { path });
}

export async function writeFileContent(path, content) {
  return invoke('write_file_content', { path, content });
}

export async function saveFile(filePath, content, encoding) {
  return invoke('save_file', { filePath, content, encoding });
}

export async function checkFileExists(path) {
  return invoke('check_file_exists', { path });
}

export async function getFileInfo(path) {
  return invoke('get_file_info', { path });
}

export async function getDirectoryContents(dirPath) {
  return invoke('get_directory_contents', { dirPath });
}

export async function renameFile(oldPath, newPath) {
  return invoke('rename_file', { oldPath, newPath });
}

export async function deleteFile(path) {
  return invoke('delete_file', { path });
}

export async function startFileWatching(filePath) {
  return invoke('start_file_watching', { filePath });
}

export async function stopFileWatching(filePath) {
  return invoke('stop_file_watching', { filePath });
}

export async function executeFile(filePath) {
  return invoke('execute_file', { filePath });
}

export async function runCodeSnippet(code, language) {
  return invoke('run_code_snippet', { code, language });
}

export async function searchFiles(dirPath, query, searchContent = false, maxResults = 100) {
  return invoke('search_files', { dirPath, query, searchContent, maxResults });
}

export async function showInExplorer(path) {
  return invoke('show_in_explorer', { path });
}

export async function showMainWindow() {
  return invoke('show_main_window');
}

export function onFileChanged(callback) {
  return listen('file-changed', (event) => callback(event.payload));
}
