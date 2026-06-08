# Android SAF 文件访问

## 功能是什么

在移动端通过 SAF 处理目录授权、文件访问和权限持久化。

## 对应代码在哪

- 代码位置：[androidSaf.js](../../../src/utils/androidSaf.js)
  符号：`pickFolder / pickFile / readFileText / writeFileText`
  作用：前端 SAF 访问统一封装。
- 代码位置：[tauriApi.js](../../../src/utils/tauriApi.js)
  符号：`isSafUri split`
  作用：把 content:// URI 分发到 Android SAF，而不是桌面 Rust 层。
- 代码位置：[MainActivity.kt](../../../src-tauri/gen/android/app/src/main/java/com/mde/app/MainActivity.kt)
  符号：`registerForActivityResult / onWebViewCreate`
  作用：把 Android 文件选择能力注入到前端。
- 代码位置：[SafBridge.kt](../../../src-tauri/gen/android/app/src/main/java/com/mde/app/SafBridge.kt)
  符号：`SafBridge`
  作用：真正调用 Android DocumentsContract 和 ContentResolver。

## 关键代码怎么读

- 第一步看 [androidSaf.js](../../../src/utils/androidSaf.js) 中的 `pickFolder / pickFile / readFileText / writeFileText`，其作用是：前端 SAF 访问统一封装。
- 第二步看 [tauriApi.js](../../../src/utils/tauriApi.js) 中的 `isSafUri split`，其作用是：把 content:// URI 分发到 Android SAF，而不是桌面 Rust 层。
- 第三步看 [MainActivity.kt](../../../src-tauri/gen/android/app/src/main/java/com/mde/app/MainActivity.kt) 中的 `registerForActivityResult / onWebViewCreate`，其作用是：把 Android 文件选择能力注入到前端。
- 第四步看 [SafBridge.kt](../../../src-tauri/gen/android/app/src/main/java/com/mde/app/SafBridge.kt) 中的 `SafBridge`，其作用是：真正调用 Android DocumentsContract 和 ContentResolver。

## 论文里是怎么定义这个功能的

- `1.3.2`
- `2.2.1`
- `4.2.4`
- `6.4.1`

## 协作建议

- 上级模块：[跨平台适配模块](./F-05-跨平台适配模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
