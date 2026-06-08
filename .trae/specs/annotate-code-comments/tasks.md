# Tasks
- [x] Task 1: 盘点注释补全范围与优先级
  - [x] SubTask 1.1: 识别 `src/`、`mde-server/src/`、`src-tauri/src/` 中需要补充文档注释的核心文件
  - [x] SubTask 1.2: 标记高优先级模块，如编辑器核心、同步服务、鉴权流程、状态管理与 Tauri 入口
  - [x] SubTask 1.3: 识别应排除或少量处理的文件，如纯样式文件、供应商代码、显而易见的样板代码

- [x] Task 2: 为前端 React 代码补充文档注释和必要功能注释
  - [x] SubTask 2.1: 为导出组件、Hook、Store、服务与工具函数补充职责说明
  - [x] SubTask 2.2: 为编辑器交互、文件管理、跨端适配、同步状态等复杂逻辑补充必要功能注释
  - [x] SubTask 2.3: 自查注释是否准确、简洁且不过度解释

- [x] Task 3: 为服务端 NestJS 代码补充文档注释和必要功能注释
  - [x] SubTask 3.1: 为控制器、服务、DTO、Guard、Strategy、Schema 等核心单元补充职责说明
  - [x] SubTask 3.2: 为鉴权、同步、数据转换与关键分支补充必要功能注释
  - [x] SubTask 3.3: 自查注释与当前接口行为是否一致

- [x] Task 4: 为 Tauri Rust 代码补充文档注释和必要功能注释
  - [x] SubTask 4.1: 为公开函数、模块入口与命令相关代码补充文档注释
  - [x] SubTask 4.2: 为平台桥接、初始化与非直观实现补充必要功能注释
  - [x] SubTask 4.3: 自查注释是否符合 Rust 代码风格且不改变行为

- [ ] Task 5: 统一校验注释质量与覆盖结果
  - [x] SubTask 5.1: 抽查高优先级模块的注释覆盖率与可读性
  - [x] SubTask 5.2: 运行现有诊断或静态检查，确认未因注释编辑引入格式或语法问题
  - [ ] SubTask 5.3: 根据验收清单逐项验证并回填完成状态

- [ ] Task 6: 处理与本次“注释补全”无关的混入功能改动
  - [ ] SubTask 6.1: 确认 `src/store/useConfigStore.js`、`src/utils/settingsSync.js`、`src/components/overlays/SettingsModal.jsx` 的功能改动是否属于用户已存在改动
  - [ ] SubTask 6.2: 若属于独立需求，则拆分为单独 spec 或单独任务，不与本次“注释补全”验收混用
  - [ ] SubTask 6.3: 在边界澄清后重新验证“未引入业务逻辑变更”验收项

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 2]
- [Task 5] depends on [Task 3]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 5]
