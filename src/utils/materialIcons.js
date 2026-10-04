/**
 * react-material-vscode-icons 完整图标模块的共享惰性加载器。
 *
 * 该包包含数千个文件与语言图标，体积较大；文件树图标（FileTypeIcon）与
 * 语言服务插件市场共用这里的模块级缓存，保证整个会话只下载、执行一次。
 */

let fullIconModule = null;
let fullIconPromise = null;

/**
 * 惰性加载图标模块。
 *
 * @returns {Promise<object>} 包含 FileIcon 与各语言图标组件的模块对象。
 */
export function loadMaterialIcons() {
  if (!fullIconPromise) {
    fullIconPromise = import('react-material-vscode-icons').then((module) => {
      fullIconModule = module;
      return module;
    });
  }
  return fullIconPromise;
}

/**
 * 读取已缓存（若已加载）的图标模块，用于初始化组件状态，避免闪烁。
 *
 * @returns {object|null} 已加载的模块对象；尚未加载时返回 null。
 */
export function getMaterialIcons() {
  return fullIconModule;
}
