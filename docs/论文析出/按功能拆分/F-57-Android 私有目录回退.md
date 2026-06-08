# Android 私有目录回退

## 功能是什么

在适配移动端时，支持应用私有文档目录作为兜底访问路径。

## 对应代码在哪

- 代码位置：[useFileManager.js](../../../src/hooks/useFileManager.js)
  符号：`ensureAndroidDocsDir`
  作用：获取应用私有 Documents 目录。
- 代码位置：[useFileManager.js](../../../src/hooks/useFileManager.js)
  符号：`Android init effect`
  作用：没有工作目录时自动把私有目录挂载到 Explorer。
- 代码位置：[useFileManager.js](../../../src/hooks/useFileManager.js)
  符号：`persistUntitledTab / saveAsDialog`
  作用：在没有稳定 Save As 时回退到私有目录保存。
- 代码位置：[tauriApi.js](../../../src/utils/tauriApi.js)
  符号：`getAppDocumentsDir`
  作用：从 Rust 层拿到应用私有目录。

## 关键代码怎么读

- 第一步看 [useFileManager.js](../../../src/hooks/useFileManager.js) 中的 `ensureAndroidDocsDir`，其作用是：获取应用私有 Documents 目录。
- 第二步看 [useFileManager.js](../../../src/hooks/useFileManager.js) 中的 `Android init effect`，其作用是：没有工作目录时自动把私有目录挂载到 Explorer。
- 第三步看 [useFileManager.js](../../../src/hooks/useFileManager.js) 中的 `persistUntitledTab / saveAsDialog`，其作用是：在没有稳定 Save As 时回退到私有目录保存。
- 第四步看 [tauriApi.js](../../../src/utils/tauriApi.js) 中的 `getAppDocumentsDir`，其作用是：从 Rust 层拿到应用私有目录。

## 论文里是怎么定义这个功能的

- `6.4.1 软件能力`

## 协作建议

- 上级模块：[跨平台适配模块](./F-05-跨平台适配模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
