# Tasks
- [ ] Task 1: 盘点论文展示端所需的数据源和映射边界
  - [ ] SubTask 1.1: 确认论文 Markdown 的来源、入口文件和渲染方式
  - [ ] SubTask 1.2: 确认 `F-xx` 功能编号与现有“按功能拆分文档”的对应关系
  - [ ] SubTask 1.3: 确认每个功能需要展示哪些结构化信息，如功能说明、相关文件、关键片段、代码树节点

- [ ] Task 2: 设计独立 React 展示端的页面结构与数据模型
  - [ ] SubTask 2.1: 明确独立入口的目录结构、页面骨架和与主应用的隔离方式
  - [ ] SubTask 2.2: 设计论文阅读区、脚注交互、功能详情弹窗、代码树区域和代码片段区域的数据模型
  - [ ] SubTask 2.3: 明确如何复用现有功能文档，以及是否需要补充结构化映射文件

- [ ] Task 3: 实现论文阅读界面与 `F-xx` 脚注交互
  - [ ] SubTask 3.1: 搭建使用 Ant Design 的独立 React 展示端基础界面，并延续 MDE 风格
  - [ ] SubTask 3.2: 加载论文 Markdown 并渲染为阅读页面
  - [ ] SubTask 3.3: 将论文中的 `F-xx` 功能标记识别为可点击脚注入口

- [ ] Task 4: 实现功能详情弹窗与源码映射展示
  - [ ] SubTask 4.1: 在弹窗中展示功能简介、相关文件列表和相对根目录路径
  - [ ] SubTask 4.2: 展示功能相关代码树，并高亮本次功能涉及的关键文件
  - [ ] SubTask 4.3: 展示每个文件对应的关键代码片段与讲解说明
  - [ ] SubTask 4.4: 支持在弹窗内切换不同相关文件和不同代码片段

- [ ] Task 5: 打通文档与源码映射数据
  - [ ] SubTask 5.1: 将现有按功能拆分文档整理为展示端可直接消费的数据源
  - [ ] SubTask 5.2: 在必要时补充结构化映射数据，避免把说明硬编码进 UI
  - [ ] SubTask 5.3: 确保映射数据能覆盖代表性功能，如多标签、增量云同步、Android SAF

- [ ] Task 6: 完成验证与交付
  - [ ] SubTask 6.1: 验证论文首页可正确加载与阅读
  - [ ] SubTask 6.2: 验证点击 `F-xx` 可打开对应功能详情弹窗
  - [ ] SubTask 6.3: 验证弹窗中代码树、文件路径和代码片段展示正确
  - [ ] SubTask 6.4: 验证独立展示端不影响现有主应用

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 1]
- [Task 5] depends on [Task 2]
- [Task 6] depends on [Task 3]
- [Task 6] depends on [Task 4]
- [Task 6] depends on [Task 5]
