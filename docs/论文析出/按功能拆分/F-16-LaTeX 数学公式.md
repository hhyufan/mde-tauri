# LaTeX 数学公式

## 功能是什么

支持行内公式与块级公式，用于学术写作和技术文档。

## 对应代码在哪

- 代码位置：[MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx)
  符号：`remarkMath / rehypeKatex`
  作用：预览侧负责把数学公式转换为可显示的 HTML。
- 代码位置：[MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx)
  符号：`mathPlugins / katexOptionsCtx`
  作用：WYSIWYG 侧启用数学公式编辑与展示。

## 关键代码怎么读

- 第一步看 [MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx) 中的 `remarkMath / rehypeKatex`，其作用是：预览侧负责把数学公式转换为可显示的 HTML。
- 第二步看 [MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx) 中的 `mathPlugins / katexOptionsCtx`，其作用是：WYSIWYG 侧启用数学公式编辑与展示。

## 论文里是怎么定义这个功能的

- `2.2.1 功能需求`
- `4.6.2 项目扩展语法识别规则设计`
- `5.2`

## 协作建议

- 上级模块：[编辑器主体模块](./F-01-编辑器主体模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
