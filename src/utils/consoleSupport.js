/**
 * 输出控制台（输出 / 问题面板）的可用性判断。
 *
 * 控制台只在「当前视图存在代码编辑器」且「文件语言受 LSP 支持或可运行」时渲染：
 * 纯预览模式下的 Milkdown 或树编辑器独占场景没有代码编辑器；纯文本等既没有
 * 语言服务也不能运行的文件同样没有输出可看，这两种情况都要隐藏入口和面板。
 */
import useLspStore, { availablePlugins } from '@store/useLspStore';
import { getScriptLanguage } from '@/services/scriptRunner';
import { getFileLanguage } from '@utils/fileLanguage';

// Markdown 在预览模式下由 Milkdown 独占渲染，没有 Monaco 代码编辑器。
const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;

/**
 * 收集所有可用语言服务插件声明的语言集合。
 *
 * 可用插件 = 内置目录 + 用户添加的目录 + 已安装插件的清单，因此判断的是
 * 「语言本身是否具备 LSP 支持」，与某台设备上服务是否已安装无关。
 *
 * @returns {Set<string>} 受 LSP 支持的语言标识集合。
 */
function lspSupportedLanguages() {
  const languages = new Set();
  for (const plugin of availablePlugins(useLspStore.getState())) {
    for (const language of plugin.languages || []) languages.add(language);
  }
  return languages;
}

/**
 * 判断单个标签页的文件是否具备控制台价值：可运行，或语言受 LSP 支持。
 *
 * @param {object|null} tab 标签元信息（含 name / ext）。
 * @returns {boolean} 文件语言可运行或受 LSP 支持。
 */
export function supportsConsoleForTab(tab) {
  if (!tab) return false;
  if (getScriptLanguage(tab.name)) return true;
  return lspSupportedLanguages().has(getFileLanguage(tab.name));
}

/**
 * 判断当前视图是否存在代码编辑器。
 *
 * 预览模式下 Markdown 由 Milkdown、树文件由树编辑器独占渲染，除此之外
 * （编辑模式、分栏模式、代码文件的回退渲染）都存在 Monaco 编辑器。
 *
 * @param {string} viewMode 当前视图模式（edit / preview / split）。
 * @param {object|null} tab 活动标签元信息。
 * @returns {boolean} 视图中是否存在代码编辑器。
 */
export function hasCodeEditor(viewMode, tab) {
  if (viewMode !== 'preview') return true;
  if (!tab) return false;
  if (MARKDOWN_RE.test(tab.name || '')) return false;
  return tab.ext?.toLowerCase() !== 'mgtree';
}

/**
 * 控制台在当前标签与视图模式下是否应该渲染。
 *
 * @param {string} viewMode 当前视图模式。
 * @param {object|null} tab 活动标签元信息。
 * @returns {boolean} 是否展示控制台入口与面板。
 */
export function consoleAvailable(viewMode, tab) {
  return hasCodeEditor(viewMode, tab) && supportsConsoleForTab(tab);
}
