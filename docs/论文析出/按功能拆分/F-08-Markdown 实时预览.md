# Markdown 实时预览

## 功能是什么

对输入内容进行即时渲染，保证编辑与观察结果之间的反馈连续。

## 对应代码在哪

- 代码位置：[MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx)
  符号：`MarkdownPreview`
  作用：根据缓冲区最新内容实时生成只读预览。
- 代码位置：[useEditorBufferContent.js](../../../src/hooks/useEditorBufferContent.js)
  符号：`useEditorBufferContent`
  作用：订阅编辑缓冲区变化，并做延迟更新避免卡顿。
- 代码位置：[MonacoEditor.jsx](../../../src/components/editor/MonacoEditor.jsx)
  符号：`onDidChangeModelContent`
  作用：输入时先写 editorBuffer，为预览提供实时数据源。
- 代码位置：[EditorContent.jsx](../../../src/components/layout/content/EditorContent.jsx)
  符号：`split layout`
  作用：在分栏模式中同时展示编辑区和预览区。

## 关键代码怎么读

- 第一步看 [MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx) 中的 `MarkdownPreview`，其作用是：根据缓冲区最新内容实时生成只读预览。
- 第二步看 [useEditorBufferContent.js](../../../src/hooks/useEditorBufferContent.js) 中的 `useEditorBufferContent`，其作用是：订阅编辑缓冲区变化，并做延迟更新避免卡顿。
- 第三步看 [MonacoEditor.jsx](../../../src/components/editor/MonacoEditor.jsx) 中的 `onDidChangeModelContent`，其作用是：输入时先写 editorBuffer，为预览提供实时数据源。
- 第四步看 [EditorContent.jsx](../../../src/components/layout/content/EditorContent.jsx) 中的 `split layout`，其作用是：在分栏模式中同时展示编辑区和预览区。

## 论文里是怎么定义这个功能的

- `2.2.1 功能需求`
- `3.1 分析目标与思路`
- `5.2`

## 协作建议

- 上级模块：[编辑器主体模块](./F-01-编辑器主体模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
