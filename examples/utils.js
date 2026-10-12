/**
 * JavaScript 示例：普通函数与模块导出。
 * 与 hello.ts 同目录，用于演示一个语言服务覆盖多种文件后缀。
 */
export function formatCount(count, unit) {
  return `${count} ${unit}`;
}

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
