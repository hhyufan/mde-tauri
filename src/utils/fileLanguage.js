/**
 * ?????????
 *
 * ????????? Monaco ???????????????????
 */
import extensionMap from '@/configs/file-extensions.json';

/**
 * 根据文件名推断 Monaco 语言标识。
 *
 * 未命中扩展名映射时回退为 `plaintext`，保证编辑器始终有可用语言模式。
 */
export function getFileLanguage(fileName) {
  if (!fileName) return 'plaintext';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return extensionMap[ext] || 'plaintext';
}
