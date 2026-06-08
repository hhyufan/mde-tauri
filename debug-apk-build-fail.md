# [OPEN] APK Build Fail

## 问题描述

- 现象：Android APK 构建失败，外层错误只显示 `gradlew.bat` 退出码为 `1`
- 目标：定位真实失败点，并给出最小修复

## 当前假设

1. Android Gradle/Kotlin 编译失败，根因在生成的 Android 工程或 Kotlin bridge 代码。
2. Rust Android 交叉编译失败，根因在 `src-tauri` 的某个 command 或 Android target 配置。
3. 前端 `beforeBuildCommand` 已通过，但 Android 打包阶段因为资源、Manifest 或 Java/Kotlin 语法错误退出。
4. 最近改动影响了 Android 平台专用分支，桌面端正常但 Android 专用代码路径编译失败。

## 证据采集计划

1. 直接运行 Android Gradle 构建命令，拿到真实 stderr。
2. 若 Gradle 输出不够，再加 `--stacktrace --info`。
3. 根据首个真实报错定位到具体文件和行号。
4. 仅在证据明确后做最小修复。
