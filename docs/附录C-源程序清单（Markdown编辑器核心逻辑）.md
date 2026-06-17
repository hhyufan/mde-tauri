# 附录 C Markdown 编辑器核心逻辑源程序

本附录用于说明当前项目中与 Markdown 编辑器核心逻辑直接相关的源程序实现，并在各节说明之后附上对应的代表性源代码，便于直接结合系统实现进行查阅。

如需进一步了解相关实现，还可以同时参考 [编辑器主题实现讲解.md](./编辑器主题实现讲解.md) 与 [自动保存和手动保存怎么实现的.md](./自动保存和手动保存怎么实现的.md)。

先用一句话概括这一套编辑器主链路：

`EditorContent 调度 -> editorBuffer 承接高频正文 -> Monaco / Milkdown / MarkdownPreview 三条渲染链 -> FloatingToolbar / Outline / markdownAssets 提供编辑增强 -> useFileManager 负责自动保存与落盘`

## C.1 附录说明

本附录不是把全部源码逐行完整展开，而是围绕 Markdown 编辑器最关键的实现环节进行说明，并在每一部分说明之后附上能够支撑相关说明的代表性源代码。这样处理，既能保持内容紧凑，也能让实际实现位置清晰可查。

本附录只覆盖 Markdown 编辑器核心逻辑，不展开登录、云同步后端和普通设置表单等外围模块。

## C.2 总体结构

当前项目中的 Markdown 编辑器并不是单一组件，而是由多个相互协作的程序共同构成。`EditorContent` 负责总调度，决定当前文档以源码编辑、所见即所得编辑还是分屏预览方式呈现；`editorBuffer` 与 `useEditorBufferContent` 负责承接高频正文输入，并将其以较低成本分发给预览区与大纲视图；`MonacoEditor`、`MilkdownMarkdownEditor` 与 `MarkdownPreview` 分别承担源码编辑、结构化编辑和只读预览三类任务；`FloatingToolbar`、`OutlineView` 与 `markdownAssets` 负责语法插入、结构导航、链接解析、图片处理和代码增强；`useFileManager` 则负责把自动保存、首次保存、手动保存与外部同步统一收敛到文件管理流程。因而，Markdown 编辑器的核心逻辑应理解为一条连续的协作链，而不是若干互不关联的页面组件。

## C.3 核心源程序说明与代码

本节对 Markdown 编辑器核心逻辑中的关键程序逐一说明，并在说明之后附上对应的源代码信息。

### C.3.1 编辑器总调度程序

程序名称：`EditorContent`

程序说明：该程序位于 [EditorContent.jsx](../src/components/layout/content/EditorContent.jsx#L182-L516)，是 Markdown 编辑器核心逻辑的总调度入口。它负责判断当前活动标签是否为 Markdown 文件，并在 `edit`、`preview`、`split` 三种模式之间切换对应渲染链，同时把浮动工具栏、自动保存、分栏拖拽和预览滚动同步等能力统一装配到工作区。

源代码位置可见 [EditorContent.jsx:L212-L225](../src/components/layout/content/EditorContent.jsx#L212-L225) 与 [EditorContent.jsx:L458-L513](../src/components/layout/content/EditorContent.jsx#L458-L513)。

源代码摘录 1：

```js
const handleToolbarInsert = useCallback((action) => {
  const editor = monacoRef.current;
  if (!editor) return;

  if (typeof editor.handleToolbarAction === 'function' && editor.handleToolbarAction(action)) {
    return;
  }

  if (action.type === 'insert') {
    editor.insertText(action.text);
  } else if (action.type === 'wrap') {
    editor.wrapSelection(action.before, action.after);
  }
}, []);
```

上述代码说明，调度层并不直接依赖某个具体编辑器实现，而是优先调用当前编辑器暴露的统一动作协议，从而使 Monaco 与 Milkdown 可以复用同一套工具栏交互。

源代码摘录 2：

```jsx
{viewMode === 'edit' && (
  <MonacoEditor
    key={activeTabId}
    ref={monacoRef}
    className="editor-content__editor"
    onAutoSave={triggerAutoSave}
  />
)}
{viewMode === 'preview' && isMarkdown && (
  <Suspense fallback={<PreviewFallback />}>
    <MilkdownMarkdownEditor
      key={activeTabId}
      ref={monacoRef}
      className="editor-content__preview editor-content__editor--milkdown"
      onAutoSave={triggerAutoSave}
    />
  </Suspense>
)}
{viewMode === 'split' && isMarkdown && (
  <>
    <MonacoEditor
      key={`${activeTabId}-split`}
      ref={monacoRef}
      className="editor-content__editor editor-content__editor--half"
      onAutoSave={triggerAutoSave}
    />
    <Suspense fallback={<PreviewFallback />}>
      <MarkdownPreview
        ref={handlePreviewRef}
        className="editor-content__preview editor-content__preview--half"
      />
    </Suspense>
  </>
)}
```

上述代码直接体现了编辑器主体的三条渲染链：源码编辑由 `MonacoEditor` 承担，所见即所得模式由 `MilkdownMarkdownEditor` 承担，分屏模式则组合 `MonacoEditor` 与 `MarkdownPreview`。

### C.3.2 正文缓冲与状态管理程序

程序名称：`editorBuffer`、`useEditorBufferContent`、`useEditorStore`

程序说明：该组程序分别位于 [editorBuffer.js](../src/utils/editorBuffer.js#L1-L99)、[useEditorBufferContent.js](../src/hooks/useEditorBufferContent.js#L1-L59) 与 [useEditorStore.js](../src/store/useEditorStore.js#L41-L260)。其中，`editorBuffer` 负责保存高频正文输入，`useEditorBufferContent` 负责以节流方式把正文暴露给预览、大纲等消费者，`useEditorStore` 则负责标签列表、活动标签、视图模式、字符统计等全局 UI 状态。三者共同构成“正文总线 + 状态容器”。

源代码位置可见 [editorBuffer.js:L13-L56](../src/utils/editorBuffer.js#L13-L56)、[useEditorBufferContent.js:L18-L57](../src/hooks/useEditorBufferContent.js#L18-L57) 与 [useEditorStore.js:L65-L118](../src/store/useEditorStore.js#L65-L118)。

源代码摘录 1：

```js
const buffers = new Map();
const listeners = new Set();

let pendingIds = new Set();
let scheduled = false;

function flush() {
  scheduled = false;
  const ids = pendingIds;
  pendingIds = new Set();
  listeners.forEach((fn) => {
    try {
      fn(ids);
    } catch (err) {
      console.warn('[editorBuffer] listener threw', err);
    }
  });
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(flush, 0);
}

export function setBuffer(tabId, content) {
  if (!tabId) return;
  const cur = buffers.get(tabId);
  if (cur === content) return;
  buffers.set(tabId, content);
  pendingIds.add(tabId);
  schedule();
}
```

这段代码说明，正文内容在输入阶段不会立刻写入全局持久状态，而是先进入内存缓冲区，再通过异步批处理通知订阅者，从而减少高频输入对界面重渲染的冲击。

源代码摘录 2：

```js
function pickDelay(baseDelay, contentLength) {
  if (contentLength > 200_000) return Math.max(baseDelay, 700);
  if (contentLength > 80_000) return Math.max(baseDelay, 480);
  if (contentLength > 30_000) return Math.max(baseDelay, 340);
  return baseDelay;
}

export function useEditorBufferContent(tabId, fallback = '', delay = 220) {
  const [content, setContent] = useState(() => getBuffer(tabId, fallback));

  useEffect(() => {
    let timer = null;
    const unsub = subscribe((ids) => {
      if (!ids.has(tabIdRef.current)) return;
      if (timer) clearTimeout(timer);
      const next = getBuffer(tabIdRef.current, fallbackRef.current);
      const actualDelay = pickDelay(delay, next?.length || 0);
      timer = setTimeout(() => {
        setContent(getBuffer(tabIdRef.current, fallbackRef.current));
      }, actualDelay);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [delay]);

  return content;
}
```

这段代码体现了正文消费者侧的节流策略。文档越长，预览与大纲更新越会适当延后，以保证编辑器输入过程保持流畅。

### C.3.3 Monaco 源码编辑程序

程序名称：`MonacoEditor`

程序说明：该程序位于 [MonacoEditor.jsx](../src/components/editor/MonacoEditor.jsx#L96-L307)，负责源码编辑模式。它不仅创建 Monaco 编辑器实例，还承担输入监听、自动保存节流、脏标记写入、字符统计更新，以及桌面右键/移动端长按的交互分流。

源代码位置可见 [MonacoEditor.jsx:L96-L131](../src/components/editor/MonacoEditor.jsx#L96-L131) 与 [MonacoEditor.jsx:L183-L233](../src/components/editor/MonacoEditor.jsx#L183-L233)。

源代码摘录 1：

```js
useImperativeHandle(ref, () => ({
  getEditor: () => editorRef.current,
  getCurrentValue: () => editorRef.current?.getValue() ?? '',
  insertText(text) {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    editor.executeEdits('toolbar', [{
      range: selection,
      text,
      forceMoveMarkers: true,
    }]);
    editor.focus();
  },
  wrapSelection(before, after) {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const selectedText = editor.getModel().getValueInRange(selection);
    editor.executeEdits('toolbar', [{
      range: selection,
      text: before + selectedText + after,
      forceMoveMarkers: true,
    }]);
    editor.focus();
  },
}), []);
```

上述代码表明，Monaco 编辑器对上层暴露的是抽象后的插入与包裹接口，而不是直接把具体编辑器对象暴露给页面其他部分。

源代码摘录 2：

```js
const scheduleAutoSave = () => {
  if (autoSaveScheduled) return;
  autoSaveScheduled = true;
  setTimeout(() => {
    autoSaveScheduled = false;
    onAutoSaveRef.current?.();
  }, 300);
};

editor.onDidChangeModelContent(() => {
  if (suppressModelChangeRef.current) return;
  const tabId = currentTabIdRef.current;
  if (!tabId) return;
  const value = editor.getValue();
  setBuffer(tabId, value);
  scheduleDirtyMark();
  scheduleCharCount();
  scheduleAutoSave();
});
```

这段代码展示了源码编辑路径的关键时序：输入事件首先更新 `editorBuffer`，随后以节流方式推进脏标记、字符统计和自动保存。

### C.3.4 Milkdown 所见即所得编辑程序

程序名称：`MilkdownMarkdownEditor`

程序说明：该程序位于 [MilkdownMarkdownEditor.jsx](../src/components/editor/MilkdownMarkdownEditor.jsx#L1400-L1708)，负责所见即所得编辑模式。它通过 Milkdown 插件系统支持 CommonMark、GFM、任务列表、数学公式、代码块预览等能力，并在编辑结构化文档后统一回写 Markdown 文本。

源代码位置可见 [MilkdownMarkdownEditor.jsx:L1400-L1450](../src/components/editor/MilkdownMarkdownEditor.jsx#L1400-L1450) 与 [MilkdownMarkdownEditor.jsx:L1455-L1541](../src/components/editor/MilkdownMarkdownEditor.jsx#L1455-L1541)。

源代码摘录 1：

```js
const editor = Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, content || '');
    ctx.set(katexOptionsCtx.key, {
      throwOnError: false,
      strict: false,
    });
    ctx.set(codeBlockConfig.key, {
      ...ctx.get(codeBlockConfig.key),
      extensions: codeBlockExtensions,
      languages: codeLanguages,
      renderPreview: renderCodeBlockPreview,
      previewOnlyByDefault: true,
    });
    ctx.get(listenerCtx)
      .markdownUpdated((_, markdown, prevMarkdown) => {
        if (markdown === prevMarkdown) return;
        scheduleEditorSideEffects(markdown);
        setRenderTick((value) => value + 1);
      });
  })
  .use(commonmark)
  .use(gfm)
  .use(taskListCheckboxPlugin)
  .use(mathPlugins)
  .use(history)
  .use(codeBlockComponent)
  .use(listener);
```

这段代码表明，Milkdown 在本项目中不只是一个只读预览器，而是具备完整插件扩展能力的结构化编辑器，同时仍然以 Markdown 文本作为全系统共享交换格式。

源代码摘录 2：

```js
useImperativeHandle(ref, () => ({
  handleToolbarAction(action) {
    let handled = false;
    editorRef.current?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      const view = ctx.get(editorViewCtx);
      const run = (command, payload) => {
        handled = Boolean(commands.call(command.key, payload));
        view.focus();
      };

      switch (action?.command) {
        case 'bold':
          run(toggleStrongCommand);
          break;
        case 'table':
          run(insertTableCommand, { row: 3, col: 3 });
          break;
        case 'link':
          {
            const { from, to, empty } = view.state.selection;
            if (empty) {
              insert('[link](url)', true)(ctx);
            } else {
              const selected = getMarkdown({ from, to })(ctx) || 'link';
              replaceRange(`[${selected}](url)`, { from, to })(ctx);
            }
            handled = true;
            view.focus();
          }
          break;
        default:
          handled = false;
      }
    });
    return handled;
  },
}), [content]);
```

这段代码说明，Milkdown 与 Monaco 共同遵循统一的工具栏动作协议，从而保证不同编辑模式下的用户操作具有一致性。

### C.3.5 Markdown 预览渲染程序

程序名称：`MarkdownPreview`

程序说明：该程序位于 [MarkdownPreview.jsx](../src/components/editor/MarkdownPreview.jsx#L146-L469)，负责只读预览模式。它从正文缓冲区读取 Markdown 内容，经过 `remark` 与 `rehype` 管线进行解析，再完成数学公式、Mermaid、代码高亮、脚注、图片及内部链接等增强渲染。

源代码位置可见 [MarkdownPreview.jsx:L146-L151](../src/components/editor/MarkdownPreview.jsx#L146-L151)、[MarkdownPreview.jsx:L159-L174](../src/components/editor/MarkdownPreview.jsx#L159-L174) 与 [MarkdownPreview.jsx:L370-L414](../src/components/editor/MarkdownPreview.jsx#L370-L414)。

源代码摘录 1：

```js
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
];
```

这段代码展示了 Markdown 预览的解析链路，即 GFM 扩展、数学公式、部分 HTML 支持以及安全过滤的组合。

源代码摘录 2：

```js
function CodeBlock({ children, className, ...props }) {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const code = String(children).replace(/\n$/, '');

  if (lang === 'mermaid') {
    const isDark = document.documentElement.dataset.theme === 'dark';
    return <MermaidRenderer code={code} isDark={isDark} />;
  }

  if (!match) {
    return <code className={className} {...props}>{children}</code>;
  }

  return <code className={`language-${lang}`} {...props}>{children}</code>;
}
```

这段代码体现了预览层对不同代码节点的分流方式，即 Mermaid 使用独立渲染器，普通代码块则保留语言标记供后续高亮处理。

源代码摘录 3：

```js
const scheduleHighlight = useCallback(() => {
  const container = containerRef.current;
  if (!container) return;

  cancelHighlightJob();

  const pending = [];
  container.querySelectorAll('pre > code[class*="language-"]').forEach((codeEl) => {
    if (codeEl.querySelector(':scope > .token')) return;
    if (codeEl.classList.contains('language-mermaid')) return;
    pending.push(codeEl);
  });

  let i = 0;
  const work = (deadline) => {
    while (i < pending.length && (deadline.didTimeout || deadline.timeRemaining() > 4)) {
      const el = pending[i++];
      try {
        Prism.highlightElement(el);
      } catch (_) {}
    }

    if (i < pending.length) {
      idleJobRef.current = requestIdle(work, { timeout: 500 });
    } else {
      addLangTags(container);
    }
  };

  idleJobRef.current = requestIdle(work, { timeout: 500 });
}, [addLangTags, cancelHighlightJob]);
```

这段代码说明，代码高亮不会阻塞当前渲染流程，而是通过浏览器空闲时间分批执行，从而提升长文档场景下的可交互性。

### C.3.6 编辑增强与导航程序

程序名称：`FloatingToolbar`、`OutlineView`、`markdownAssets`

程序说明：这组三个程序分别位于 [FloatingToolbar.jsx](../src/components/editor/FloatingToolbar.jsx#L107-L326)、[OutlineView.jsx](../src/components/layout/sidebar/outline/OutlineView.jsx#L85-L230) 与 [markdownAssets.js](../src/utils/markdownAssets.js#L1-L247)。其中，`FloatingToolbar` 负责把常见 Markdown 语法操作标准化为统一命令，`OutlineView` 负责提取正文结构并提供导航，`markdownAssets` 负责内部链接、图片路径和行号提示的统一解析。

源代码位置可见 [FloatingToolbar.jsx:L121-L144](../src/components/editor/FloatingToolbar.jsx#L121-L144)、[OutlineView.jsx:L98-L118](../src/components/layout/sidebar/outline/OutlineView.jsx#L98-L118) 与 [markdownAssets.js:L127-L173](../src/utils/markdownAssets.js#L127-L173)。

源代码摘录 1：

```js
const runAction = useCallback((action) => {
  onInsert?.(action);
  setHeadingOpen(false);
}, [onInsert]);

const wrap = useCallback((command, before, after) => {
  runAction({ type: 'wrap', command, before, after: after ?? before });
}, [runAction]);

const insertBlock = useCallback((text) => {
  runAction({ type: 'insert', text });
}, [runAction]);
```

这段代码表明，工具栏自身并不操作具体编辑器，而是首先把用户操作抽象为标准化命令，再由调度层转发给当前编辑器实例。

源代码摘录 2：

```js
const content = useEditorBufferContent(activeTabId, fallback, 320);
const [collapsed, setCollapsed] = useState({});

const items = useMemo(() => extractItems(content), [content]);

const headings = useMemo(() => items.filter((it) => it.type === 'heading'), [items]);
const minLevel = useMemo(
  () => (headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1),
  [headings],
);
```

这段代码说明，大纲视图并不维护另一套独立文档模型，而是直接消费正文缓冲区中的 Markdown 内容，保证结构导航始终与当前编辑内容保持一致。

源代码摘录 3：

```js
export function resolveMarkdownLinkPath(href, documentPath) {
  const normalizedHref = fileUrlToPath((href || '').trim());
  if (!normalizedHref) {
    return { path: '', internal: false, hash: '' };
  }
  if (normalizedHref.startsWith('#')) {
    return { path: '', internal: false, hash: normalizedHref.slice(1) };
  }
  if (EXTERNAL_LINK_RE.test(normalizedHref)) {
    return { path: normalizedHref, internal: false, hash: '' };
  }

  const [pathWithQuery = '', hash = ''] = normalizedHref.split('#', 2);
  const [pathPart = ''] = pathWithQuery.split('?', 1);
  const decodedPath = decodeURI(pathPart);
  if (!decodedPath) {
    return { path: '', internal: false, hash };
  }
  return {
    path: joinPath(dirname(documentPath), decodedPath),
    internal: true,
    hash,
  };
}

export function parseMarkdownLineHint(value) {
  const match = String(value || '').match(LINE_HINT_RE);
  if (!match) return null;
  const line = Number(match[1] || 0);
  const endLine = Number(match[2] || 0);
  if (!Number.isFinite(line) || line <= 0) return null;
  return {
    line,
    endLine: Number.isFinite(endLine) && endLine > 0 ? endLine : line,
  };
}
```

这段代码对应项目中的内部链接增强能力，即相对路径在应用内打开，并能从 `#Lxx` 与 `Lxx~xx` 形式中解析出跳转行号。

### C.3.7 保存与持久化协作程序

程序名称：`useFileManager`

程序说明：该程序位于 [useFileManager.js:L301-L325](../src/hooks/useFileManager.js#L301-L325) 与 [useFileManager.js:L769-L825](../src/hooks/useFileManager.js#L769-L825)。它是 Markdown 编辑器与底层文件系统之间的桥梁，统一处理自动保存、首次保存、已有路径文件保存以及云端外部文档的落盘分支。

源代码位置可见 [useFileManager.js:L301-L325](../src/hooks/useFileManager.js#L301-L325) 与 [useFileManager.js:L769-L825](../src/hooks/useFileManager.js#L769-L825)。

源代码摘录 1：

```js
const triggerAutoSave = useCallback(() => {
  const autoSave = useConfigStore.getState().autoSave;
  if (!autoSave) return;
  const tab = useEditorStore.getState().getActiveTab();
  if (!tab) return;
  const content = getBuffer(tab.id, tab.content);
  if (!tab.path && tab.externalFileId) {
    debouncedExternalSync(tab.id, tab.externalFileId, content, tab.encoding, {
      name: tab.name,
      lineEnding: tab.lineEnding,
    });
    return;
  }
  if (!tab.path) {
    const canSaveToExplorerDir = hasOpenExplorerDirectory();
    if (!canSaveToExplorerDir && dismissedAutoSavePromptRef.current.has(tab.id)) return;
    persistUntitledTab(tab, { allowDialog: !canSaveToExplorerDir, source: 'auto-save' });
    return;
  }
  debouncedAutoSave(tab.path, content, tab.encoding, {
    name: tab.name,
    ext: tab.ext,
    lineEnding: tab.lineEnding,
  });
}, [debouncedAutoSave, debouncedExternalSync]);
```

这段代码展示了自动保存的分支判定逻辑，即系统会根据标签是否已有路径、是否为外部云文档、是否允许首次落盘来决定后续保存策略。

源代码摘录 2：

```js
const saveTab = useCallback(async (tabId) => {
  const activeId = useEditorStore.getState().activeTabId;
  const tab = getLiveTabById(tabId || activeId);
  if (!tab) return { ok: false };

  if (!tab.path) {
    dismissedAutoSavePromptRef.current.delete(tab.id);
    const targetPath = await persistUntitledTab(tab, { allowDialog: true, source: 'manual-save' });
    return targetPath
      ? { ok: true, tabId: targetPath }
      : { ok: false, cancelled: true };
  }

  try {
    const result = await saveFile(tab.path, tab.content, tab.encoding);
    if (result.success) {
      markTabSaved(tab.id);
      notify('success', t('notification.fileSaved'), tab.name);
    }
  } catch (err) {
    notify('error', t('notification.error'), String(err));
  }
  return { ok: true, tabId: tab.id };
}, [isAndroid, notify, persistUntitledTab, t]);

const saveCurrentFile = useCallback(async () => {
  await saveTab();
}, [saveTab]);
```

这段代码说明，编辑器层只负责产生正文和触发保存时机，真正的持久化策略则统一由文件管理层处理，从而把编辑逻辑与文件系统逻辑解耦。

## C.4 概括

“本系统的 Markdown 编辑器采用由调度程序、正文缓冲程序、多种编辑与预览程序、编辑增强程序以及保存协作程序共同组成的协作结构。`EditorContent` 负责在源码编辑、所见即所得编辑和分屏预览之间进行模式分流；`editorBuffer` 负责隔离高频正文输入；`MonacoEditor`、`MilkdownMarkdownEditor` 与 `MarkdownPreview` 分别承担源码编辑、结构化编辑和预览渲染；`FloatingToolbar`、`OutlineView` 与 `markdownAssets` 提供语法插入、结构导航和内部链接解析；`useFileManager` 则统一接管自动保存与手动保存流程。附录 C 在各部分说明之后给出了对应的代表性源代码，用于说明这些实现如何在系统中落地。”

## C.5 小结

本附录的重点并不在于枚举文件数量，而在于说明 Markdown 编辑器核心逻辑由哪些关键程序构成、这些程序分别承担何种职责，以及这些职责在源代码中如何体现。通过“先说明、后附代码”的方式，可以更直观地展示各部分实现之间的关系。
