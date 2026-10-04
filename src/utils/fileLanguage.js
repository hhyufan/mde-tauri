/**
 * ?????????
 *
 * ????????? Monaco ???????????????????
 */
import extensionMap from '@/configs/file-extensions.json';
import useLspStore from '@store/useLspStore';

/**
 * 根据文件名推断 Monaco 语言标识。
 *
 * 未命中扩展名映射时回退为 `plaintext`，保证编辑器始终有可用语言模式。
 *
 * 注意：这里的每个取值都必须是 Monaco 真实注册的语言 id，否则
 * `setModelLanguage` 拿不到分词器，编辑器会退化成没有颜色的纯文本。
 * 因此 `.vue` / `.svelte` 映射到 `html`，`.sass` 映射到 `scss`，
 * `.toml` / `.env` 映射到 `ini`——Monaco 本身并不提供这几个 id。
 */
export function getFileLanguage(fileName) {
  if (!fileName) return 'plaintext';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const contributed = useLspStore.getState().installed.find((plugin) => plugin.manifest.extensions?.[ext]);
  if (contributed) return contributed.manifest.extensions[ext];
  return extensionMap[ext] || 'plaintext';
}
