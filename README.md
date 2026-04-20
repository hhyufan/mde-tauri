# MDE · Markdown Editor

**语言 / Language**: 中文 | [English](README_EN.md)

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Vite](https://img.shields.io/badge/Vite-6.2.4-646CFF?logo=vite) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb)

**MDE** 是一个基于 Tauri 2 + React + Monaco Editor 的跨平台 Markdown 编辑器，支持本地写作、实时预览、云端同步、冲突处理与设置同步。

> ⚡ 基于 Rust + 系统 WebView，桌面端轻量、启动快、打包体积小。

---

## 🚀 当前功能点（与代码同步）

### ✍️ 编辑体验

- **Monaco 编辑器**：代码级编辑体验，支持多语言语法着色与常规编辑行为。
- **多标签页工作流**：新建、关闭、重命名标签，支持未保存状态提示。
- **三种视图模式**：编辑 / 预览 / 分屏，Markdown 与非 Markdown 文件自动回退逻辑。
- **浮动工具栏**：粗体、斜体、标题、表格、代码块、链接、图片、任务列表、分割线等快速插入。
- **快速搜索**：`Ctrl+P` 打开搜索弹窗，支持按文件名搜索与 Markdown 内容搜索（可切换）。

### 🔍 Markdown 预览

- **GFM 支持**：表格、任务列表、删除线、脚注等常见语法。
- **数学公式**：`remark-math + rehype-katex` 渲染 LaTeX。
- **Mermaid 图表**：直接渲染 `mermaid` 代码块。
- **代码高亮与复制**：预览区代码块支持语言标识与一键复制。
- **安全渲染**：`rehype-sanitize` 白名单策略，降低 XSS 风险。
- **大纲联动跳转**：标题锚点、脚注跳转与预览滚动联动。

### ☁️ 云同步（文档 + 设置）

- **账号体系**：注册 / 登录 / JWT 鉴权。
- **文档同步引擎**：基于 `fileId + rev/baseRev + mutation queue` 的增量同步模型。
- **同步绑定策略**：本地文件仅在“已收藏（bookmark）”或“已有 cloud fileId”时参与同步。
- **冲突处理**：检测冲突后弹窗比对，可选择保留本地或采用远端。
- **云端仅文档支持**：支持 `cloud://<fileId>` 形式的云文档打开与后续认领到本地路径。
- **设置同步**：主题、编辑器配置、布局等可同步到云端，并支持“拉取云端覆盖本地”。
- **设置导入导出**：支持设置 JSON 的导出 / 导入。

### 🧭 侧栏与工作区

- **资源管理器**：目录浏览、排序、新建文件、打开文件夹、保存。
- **大纲视图**：解析 Markdown 标题结构。
- **最近文件**：最近打开记录、收藏优先、支持删除条目与清空。
- **统计面板**：打开文件数、总字数、文件类型分布等可视化统计。

### 🎨 UI / UX

- **明暗主题切换**：主题持久化，切换动画过渡。
- **国际化**：中英双语界面（i18next）。
- **自定义标题栏**：窗口控制（最小化/最大化/关闭）与原生拖拽区域。
- **通知系统**：Toast + Notification 双通道反馈。

---

## ⌨️ 常用快捷键

- `Ctrl+P`：打开文件搜索 / 内容搜索
- `Ctrl+S`：保存当前文件
- `Ctrl+O`：打开文件或目录
- `Ctrl+,`：打开设置
- `Ctrl+B`：切换侧栏显示
- `Ctrl+Shift+/`：编辑与预览模式切换
- `Esc`：关闭搜索/设置/登录弹窗

---

## 📦 安装

前往 [Releases](../../releases) 页面下载最新版本。

### Windows

- **EXE 安装程序**：推荐，下载即装
- **MSI 安装包**：适合系统集成场景

### macOS

- **Apple Silicon (M 系列)**：`mde_x.x.x_aarch64.dmg`
- **Intel**：`mde_x.x.x_x64.dmg`

### Linux

- **Ubuntu / Debian**：`.deb`
- **Red Hat / Fedora**：`.rpm`
- **通用发行版**：`.AppImage`

---

## 📸 截图（占位）

> 下面全部是占位路径（故意用假的），后续你可直接替换同名图片。

### 已有占位（保留）

| 浅色模式 | 深色模式 |
| -------- | -------- |
| ![浅色模式](images/light.png) | ![深色模式](images/dark.png) |

| 编辑 + 分屏预览 | Mermaid 图表 |
| --------------- | ------------ |
| ![分屏](images/split.png) | ![Mermaid](images/mermaid.png) |

| 资源管理器 & 大纲 | 云端同步登录 |
| ----------------- | ------------ |
| ![侧边栏](images/sidebar.png) | ![登录](images/login.png) |

### 建议新增占位（按功能补齐）

| 浮动工具栏 | 搜索（文件/内容） |
| ---------- | ----------------- |
| ![工具栏](images/toolbar-floating.png) | ![搜索](images/search-modal-content.png) |

| 标签页重命名 | 最近文件（收藏优先） |
| ------------ | -------------------- |
| ![标签重命名](images/tab-rename.png) | ![最近文件](images/recent-with-bookmarks.png) |

| 设置-外观/编辑器 | 设置-云同步 |
| ---------------- | ----------- |
| ![设置外观](images/settings-appearance-editor.png) | ![设置云同步](images/settings-cloud.png) |

| 冲突对话框（本地/远端） | 同步状态指示器 |
| ---------------------- | -------------- |
| ![冲突处理](images/sync-conflict-dialog.png) | ![同步状态](images/sync-status-indicator.png) |

| 统计面板 | 云端文档（cloud://） |
| -------- | -------------------- |
| ![统计面板](images/stats-panel.png) | ![云端文档](images/cloud-doc-tab.png) |

| 代码块复制反馈 | 脚注跳转 |
| -------------- | -------- |
| ![代码复制](images/preview-copy-code.png) | ![脚注跳转](images/preview-footnote-jump.png) |

---

## 🛠 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 桌面壳 | Tauri 2（Rust） |
| 前端 | React 18 + Ant Design 5 + Zustand |
| 编辑器 | Monaco Editor + Shiki |
| Markdown 渲染 | react-markdown + remark-gfm + remark-math + rehype-katex + rehype-sanitize |
| 图表 | Mermaid |
| 国际化 | i18next + react-i18next |
| 构建 | Vite 6 + Tauri CLI 2 |
| 服务端 | NestJS 10 + Mongoose 8 |
| 数据库 | MongoDB |
| 认证 | JWT + Passport（Local/JWT Strategy） |

---

## 📂 项目结构（当前仓库）

```text
mde-tauri/
├── src/                      # React 前端源码
│   ├── components/           # 编辑器、布局、弹窗、UI组件
│   ├── hooks/                # 业务 hooks（文件管理、buffer）
│   ├── services/             # API 客户端、同步引擎
│   ├── store/                # Zustand 状态管理
│   ├── utils/                # 工具函数与 Tauri API 封装
│   ├── i18n/                 # 国际化资源
│   └── App.jsx               # 前端入口组件
├── src-tauri/                # Tauri Rust 侧（命令、能力、打包配置）
├── mde-server/               # NestJS 云同步服务
│   ├── src/auth/             # 认证模块
│   ├── src/sync/             # 同步模块
│   ├── src/users/            # 用户模块
│   └── src/schemas/          # Mongo Schema
├── public/                   # 静态资源
├── UI/                       # 设计/演示素材（非 README 正式截图目录）
└── README.md
```

---

## 🛠️ 开发环境

### 前置要求

| 工具 | 建议版本 | 说明 |
| ---- | -------- | ---- |
| Node.js | 18+ | 前后端依赖安装与构建 |
| Rust | 1.77+ | Tauri 编译 |
| MongoDB | 6+ | 服务端存储 |
| WebView2 | 系统自带 | Windows 下 Tauri 运行环境 |

### 1) 启动桌面端（当前目录）

```bash
# 在仓库根目录 mde-tauri/
npm install

# 仅前端开发（浏览器）
npm run dev

# Tauri 桌面开发（Vite + Rust）
npm run tauri:dev
```

### 2) 启动云服务（mde-server）

```bash
cd mde-server
npm install

# 复制环境变量模板并修改
cp .env.example .env

# 开发模式
npm run start:dev
```

### 3) 构建桌面应用

```bash
# 回到仓库根目录 mde-tauri/
npm run tauri:build

# 产物目录
# src-tauri/target/release/bundle/
```

---

## ⚙️ 配置说明

### 客户端（设置面板）

- **General**：语言、工作区路径、自动保存
- **Appearance**：主题、字号
- **Editor**：Tab 宽度、自动换行、行号、minimap、字体
- **Cloud**：服务端地址、同步开关、账号状态、设置同步、JSON 导入导出

### 服务端（`.env`）

```env
MONGODB_URI=mongodb://localhost:27017/mde
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
PORT=3000
```

---

## 🤝 贡献指南

欢迎通过 PR 参与改进：

1. Fork 本仓库
2. 创建分支：`git checkout -b feature/xxx`
3. 提交代码：`git commit -m "feat: xxx"`
4. 推送分支：`git push origin feature/xxx`
5. 创建 Pull Request

建议遵循 [Conventional Commits](https://www.conventionalcommits.org/)。

---

## 📄 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。

---

**MDE** — 专注写作，把复杂交给工具。
