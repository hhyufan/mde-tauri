import { FileIcon as VsCodeFileIcon } from 'react-material-vscode-icons';

const EXTENSION_ALIASES = {
  markdown: 'md',
  mdown: 'md',
  yml: 'yaml',
  htm: 'html',
  jpeg: 'jpg',
  text: 'txt',
};

/**
 * 归一化扩展名，兼容别名与文件名回退推断。
 */
function normalizeExtension(extension = '', fileName = '') {
  const fromExtension = String(extension || '').trim();
  const raw =
    fromExtension ||
    String(fileName || '')
      .split('.')
      .pop() ||
    '';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return EXTENSION_ALIASES[normalized] || normalized;
}

/**
 * 为 VS Code 风格图标组件补全可识别的文件名。
 */
function buildFileName(extension = '', fileName = '') {
  const normalizedExtension = normalizeExtension(extension, fileName);
  const normalizedFileName = String(fileName || '').trim();
  if (normalizedFileName) return normalizedFileName;
  return normalizedExtension ? `file.${normalizedExtension}` : 'file.txt';
}

/**
 * 文件类型图标封装。
 *
 * 对第三方 VS Code 图标组件做一层适配，统一处理扩展名别名、文件夹态与默认名。
 */
function FileTypeIcon({
  extension = '',
  fileName = '',
  size = 16,
  className = '',
  isFolder = false,
  isExpanded = false,
}) {
  const resolvedFileName = buildFileName(extension, fileName);

  return (
    <VsCodeFileIcon
      fileName={resolvedFileName}
      size={size}
      className={className}
      isFolder={isFolder}
      isExpanded={isExpanded}
    />
  );
}

export default FileTypeIcon;
