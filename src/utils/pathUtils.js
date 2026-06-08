/**
 * 路径展示与回拼工具模块。
 *
 * 为面包屑、文件名提取和路径片段回组装提供跨平台的轻量辅助函数。
 */
/**
 * 路径拆分工具集。
 *
 * 主要服务于面包屑与路径展示场景，兼容 Windows 盘符路径、Unix 绝对路径
 * 以及普通相对路径。
 */
export const splitPath = (filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    return [];
  }

  if (/^[A-Z]:\\/i.test(filePath)) {
    const parts = filePath.split('\\');
    const drive = parts[0] + '\\';
    const restParts = parts.slice(1).filter(Boolean);
    return [drive, ...restParts];
  }

  if (filePath.startsWith('/')) {
    return filePath.split('/').filter(Boolean);
  }

  return filePath.split(/[\\/]/).filter(Boolean);
};

/**
 * 根据路径片段与目标下标回拼到当前位置的完整路径。
 */
export const buildFullPath = (pathSegments, index) => {
  if (!pathSegments || index < 0 || index >= pathSegments.length) {
    return '';
  }

  if (pathSegments[0] && pathSegments[0].endsWith('\\')) {
    const segments = pathSegments.slice(0, index + 1);
    if (index === 0) {
      return segments[0];
    }
    return segments[0] + segments.slice(1).join('\\');
  }

  const segments = pathSegments.slice(0, index + 1);
  return '/' + segments.join('/');
};

/**
 * 提取路径中的最终文件名部分。
 */
export const getFileName = (filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }
  return filePath.split(/[\\/]/).pop() || '';
};
