# 脚注与部分 HTML 支持

## 功能是什么

补充脚注、部分 HTML 等扩展渲染能力，以增强实际写作表达力。

## 对应代码在哪

- 代码位置：[footnoteParser.js](../../../src/utils/footnoteParser.js)
  符号：`parseFootnotes`
  作用：预处理脚注引用和定义，生成可跳转结构。
- 代码位置：[footnoteParser.js](../../../src/utils/footnoteParser.js)
  符号：`addFootnoteJumpHandlers`
  作用：处理脚注点击跳转和高亮反馈。
- 代码位置：[MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx)
  符号：`rehypeRaw / custom components`
  作用：支持部分 HTML 节点与脚注结果的最终渲染。

## 关键代码怎么读

- 第一步看 [footnoteParser.js](../../../src/utils/footnoteParser.js) 中的 `parseFootnotes`，其作用是：预处理脚注引用和定义，生成可跳转结构。
- 第二步看 [footnoteParser.js](../../../src/utils/footnoteParser.js) 中的 `addFootnoteJumpHandlers`，其作用是：处理脚注点击跳转和高亮反馈。
- 第三步看 [MarkdownPreview.jsx](../../../src/components/editor/MarkdownPreview.jsx) 中的 `rehypeRaw / custom components`，其作用是：支持部分 HTML 节点与脚注结果的最终渲染。

## 论文里是怎么定义这个功能的

- `4.6.2`
- `5.2`
- `6.4.1`

## 协作建议

- 上级模块：[编辑器主体模块](./F-01-编辑器主体模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
