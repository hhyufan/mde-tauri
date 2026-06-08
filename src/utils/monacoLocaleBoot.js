/**
 * Monaco ????????
 *
 * ???????????? Monaco ?????????????????
 */
// 纯副作用启动模块，必须作为 `main.jsx` 中最早执行的导入之一。
//
// 原因是 Monaco 会在模块求值阶段，通过顶层 `nls.localize(...)`
// 直接捕获一批界面文案，比如图标标题、"Find" / "Replace" 这类控件标签。
// 如果等到首次导入 `monaco-editor` 之后才设置语言，这些早已缓存的字符串
// 就会一直停留在英文，即使用户后来切到中文也不会刷新。
//
// 这个模块的职责就是在任何 Monaco 代码运行前，先同步完成语言环境初始化。
import { initMonacoLocale } from './monacoLocale';

initMonacoLocale();

if (import.meta.env.DEV) {
  const state = globalThis.__MONACO_NLS_ADAPTER_STATE__;
  const findKey = 'vs/editor/contrib/find/browser/findWidget';

  console.log('[mde/nls-boot]', {
    localeName: state?.name,
    hasData: !!state?.data,
    findWidgetPresent: !!state?.data?.[findKey],
    sampleZh: state?.data?.[findKey]?.['label.find'] ?? '(missing)',
  });
}

