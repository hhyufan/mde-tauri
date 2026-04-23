// Side-effect module — MUST be the very first import in main.jsx.
//
// Why: Monaco captures many UI strings at module-evaluation time (icon titles,
// widget labels like "Find" / "Replace", etc.) via top-level `nls.localize(...)`
// calls. If the locale state is set after monaco-editor is first imported,
// those early-captured strings stay English forever, even if the user picks 中文.
//
// This module imports the NLS proxy and the zh-hans dictionary synchronously,
// then calls setLocaleData() before any Monaco code has a chance to run.
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

