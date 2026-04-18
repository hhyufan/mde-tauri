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

export const getFileName = (filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }
  return filePath.split(/[\\/]/).pop() || '';
};
