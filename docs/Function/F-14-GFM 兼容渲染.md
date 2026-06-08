# GFM 兼容渲染

## 功能是什么

支持 GitHub Flavored Markdown 的常见块级与行内语法。

## 对应代码在哪

- 代码位置：[MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx)
  符号：`remarkPlugins / rehypePlugins`
  作用：预览侧启用 GFM、数学、HTML、KaTeX 等解析链。
- 代码位置：[MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx)
  符号：`commonmark / gfm plugins`
  作用：WYSIWYG 侧启用 Markdown 扩展解析。
- 代码位置：[package.json](../../../package.json)
  符号：`react-markdown / remark-gfm / rehype-* / @milkdown/*`
  作用：定义该功能依赖的第三方技术栈。

## 关键代码怎么读

- 第一步看 [MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx) 中的 `remarkPlugins / rehypePlugins`，其作用是：预览侧启用 GFM、数学、HTML、KaTeX 等解析链。
- 第二步看 [MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx) 中的 `commonmark / gfm plugins`，其作用是：WYSIWYG 侧启用 Markdown 扩展解析。
- 第三步看 [package.json](../../../package.json) 中的 `react-markdown / remark-gfm / rehype-* / @milkdown/*`，其作用是：定义该功能依赖的第三方技术栈。

## 论文里是怎么定义这个功能的

- `2.2.1 功能需求`
- `4.6.1 GFM核心语法规则设计`
- `5.2`

## 协作建议

- 上级模块：[编辑器主体模块](./F-01-编辑器主体模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
