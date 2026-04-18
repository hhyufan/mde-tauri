import extensionMap from '@/configs/file-extensions.json';

export function getFileLanguage(fileName) {
  if (!fileName) return 'plaintext';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return extensionMap[ext] || 'plaintext';
}
