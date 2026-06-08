# Tasks
- [x] Task 1: 盘点项目全景信息与文档边界
  - [x] SubTask 1.1: 识别项目的主要子系统、核心目录、运行入口与关键配置文件
  - [x] SubTask 1.2: 梳理 React 前端、Tauri Rust、NestJS 服务端之间的职责边界与调用关系
  - [x] SubTask 1.3: 确认哪些内容必须写入综合文档，哪些细枝末节应作为补充说明而非主线结构

- [x] Task 2: 设计综合技术文档的章节结构与阅读路径
  - [x] SubTask 2.1: 定义适合零基础读者的章节顺序，如项目概览、架构、目录、核心链路、运行调试、术语
  - [x] SubTask 2.2: 为每个章节列出需要解释的重点问题，确保不是只罗列文件名
  - [x] SubTask 2.3: 明确哪些章节需要强调平台差异、状态流转与模块协作关系

- [x] Task 3: 编写项目综合技术文档主体内容
  - [x] SubTask 3.1: 编写项目定位、能力概览、整体架构与端到端协作说明
  - [x] SubTask 3.2: 编写前端、服务端、Tauri Rust、关键状态管理与桥接层的模块说明
  - [x] SubTask 3.3: 编写文件管理、编辑器渲染、同步、鉴权与平台适配等核心流程说明
  - [x] SubTask 3.4: 编写本地运行、调试入口、常见命令、关键配置、术语表与阅读建议

- [x] Task 4: 校正文档准确性与陌生读者可读性
  - [x] SubTask 4.1: 逐段核对文档描述与当前代码实现是否一致
  - [x] SubTask 4.2: 检查文档是否默认了过多前置知识，并补足必要背景解释
  - [x] SubTask 4.3: 修正文档中可能存在的模糊表述、遗漏模块或不准确链路描述

- [x] Task 5: 按验收清单完成最终验证
  - [x] SubTask 5.1: 对照清单检查是否覆盖项目全景、模块职责、关键流程、运行调试和术语说明
  - [x] SubTask 5.2: 确认文档能够支持“从 0 开始”的阅读路径，而非仅服务于熟悉代码的开发者
  - [x] SubTask 5.3: 回填 `checklist.md` 与任务状态，准备交付

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 4]
