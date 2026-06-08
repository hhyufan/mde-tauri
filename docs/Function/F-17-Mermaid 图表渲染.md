# Mermaid 图表渲染

## 功能是什么

支持基于 Mermaid 代码块的图表渲染。

## 对应代码在哪

- 代码位置：[MermaidRenderer.jsx](../../../src/components/editor/MermaidRenderer.jsx)
  符号：`MermaidRenderer`
  作用：把 Mermaid 源码渲染为 SVG 图表。
- 代码位置：[MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx)
  符号：`CodeBlock`
  作用：预览侧识别 mermaid 代码块并分流到专用渲染器。
- 代码位置：[MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx)
  符号：`renderMermaidPreview`
  作用：WYSIWYG 侧为 Mermaid 代码块提供内联预览。

## 关键代码怎么读

- 第一步看 [MermaidRenderer.jsx](../../../src/components/editor/MermaidRenderer.jsx) 中的 `MermaidRenderer`，其作用是：把 Mermaid 源码渲染为 SVG 图表。
- 第二步看 [MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx) 中的 `CodeBlock`，其作用是：预览侧识别 mermaid 代码块并分流到专用渲染器。
- 第三步看 [MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx) 中的 `renderMermaidPreview`，其作用是：WYSIWYG 侧为 Mermaid 代码块提供内联预览。

## 论文里是怎么定义这个功能的

- 摘要
- `2.2.1 功能需求`
- `4.6.2`
- `5.2`
- `6.4.1`

## 协作建议

- 上级模块：[编辑器主体模块](./F-01-编辑器主体模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
