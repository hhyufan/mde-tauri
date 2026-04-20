import { FileIcon as VsCodeFileIcon } from 'react-material-vscode-icons';

const EXTENSION_ALIASES = {
  markdown: 'md',
  mdown: 'md',
  yml: 'yaml',
  htm: 'html',
  jpeg: 'jpg',
  text: 'txt',
};

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

function buildFileName(extension = '', fileName = '') {
  const normalizedExtension = normalizeExtension(extension, fileName);
  const normalizedFileName = String(fileName || '').trim();
  if (normalizedFileName) return normalizedFileName;
  return normalizedExtension ? `file.${normalizedExtension}` : 'file.txt';
}

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
