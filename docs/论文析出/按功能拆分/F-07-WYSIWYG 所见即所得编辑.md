# WYSIWYG 所见即所得编辑

## 功能是什么

通过可视化编辑方式降低 Markdown 使用门槛，让用户围绕视觉结构直接编辑内容。

## 对应代码在哪

- 代码位置：[MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx)
  符号：`MilkdownMarkdownEditor`
  作用：所见即所得编辑模式的组件外壳。
- 代码位置：[MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx)
  符号：`MilkdownInner`
  作用：初始化 Milkdown 编辑器，并把编辑结果回写到统一缓冲区。
- 代码位置：[MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx)
  符号：`handleToolbarAction`
  作用：处理加粗、标题、表格、任务列表等可视化编辑动作。

## 关键代码怎么读

- 第一步看 [MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx) 中的 `MilkdownMarkdownEditor`，其作用是：所见即所得编辑模式的组件外壳。
- 第二步看 [MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx) 中的 `MilkdownInner`，其作用是：初始化 Milkdown 编辑器，并把编辑结果回写到统一缓冲区。
- 第三步看 [MilkdownMarkdownEditor.jsx](../../../src/components/editor/MilkdownMarkdownEditor.jsx) 中的 `handleToolbarAction`，其作用是：处理加粗、标题、表格、任务列表等可视化编辑动作。

## 论文里是怎么定义这个功能的

- 摘要
- `1.2.2 发展趋势`
- `5.2`
- `6.4.1 软件能力`

## 协作建议

- 上级模块：[编辑器主体模块](./F-01-编辑器主体模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
