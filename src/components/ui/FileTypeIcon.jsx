import { useEffect, useState } from 'react';
import { getMaterialIcons, loadMaterialIcons } from '@utils/materialIcons';

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

const COLORS = {
  md: '#519aba', mdx: '#519aba', js: '#f1e05a', jsx: '#61dafb', ts: '#3178c6',
  tsx: '#61dafb', json: '#cbcb41', html: '#e34c26', css: '#563d7c', scss: '#c6538c',
  yaml: '#cb171e', toml: '#9c4221', rs: '#dea584', py: '#3572a5', java: '#b07219', kt: '#a97bff', kts: '#a97bff', cs: '#178600', txt: '#8b949e',
};

/**
 * 文件类型图标封装。
 *
 * 使用少量本地 SVG 和常用扩展名颜色映射作为无闪烁占位。
 */
function LightweightFallback({
  extension = '',
  fileName = '',
  size = 16,
  className = '',
  isFolder = false,
  isExpanded = false,
}) {
  const ext = normalizeExtension(extension, fileName);
  if (isFolder) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill={isExpanded ? '#dcb67a' : '#c69c5d'} d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9l2 2h8.5A1.5 1.5 0 0 1 21 7.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      </svg>
    );
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill={COLORS[ext] || '#8b949e'} d="M6 2h8l4 4v16H6z" opacity=".9" />
      <path fill="rgba(255,255,255,.75)" d="M14 2v5h5z" />
      {size >= 16 && <text x="12" y="17" textAnchor="middle" fontSize="5.2" fontWeight="700" fill="#fff">{ext.slice(0, 3).toUpperCase()}</text>}
    </svg>
  );
}

function FileTypeIcon(props) {
  const { extension = '', fileName = '', size = 16, className = '', isFolder = false, isExpanded = false } = props;
  const [FullIcon, setFullIcon] = useState(() => getMaterialIcons()?.FileIcon);
  const normalizedFileName = String(fileName || '').trim();
  const ext = normalizeExtension(extension, fileName);
  const resolvedFileName = normalizedFileName || (ext ? `file.${ext}` : 'file.txt');

  useEffect(() => {
    const cached = getMaterialIcons();
    if (cached) {
      setFullIcon(() => cached.FileIcon);
      return undefined;
    }

    let active = true;
    const load = () => {
      loadMaterialIcons().then((module) => {
        if (active) setFullIcon(() => module.FileIcon);
      });
    };
    const idleId = window.requestIdleCallback?.(load, { timeout: 1500 });
    const timeoutId = idleId == null ? window.setTimeout(load, 250) : null;

    return () => {
      active = false;
      if (idleId != null) window.cancelIdleCallback?.(idleId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);

  if (!FullIcon) return <LightweightFallback {...props} />;

  return (
    <FullIcon
      fileName={resolvedFileName}
      size={size}
      className={className}
      isFolder={isFolder}
      isExpanded={isExpanded}
    />
  );
}

export default FileTypeIcon;
