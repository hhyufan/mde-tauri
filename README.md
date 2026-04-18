# MDE · Markdown Editor

**语言 / Language**: 中文 | [English](README_EN.md)

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Vite](https://img.shields.io/badge/Vite-6.2.4-646CFF?logo=vite) ![Ant Design](https://img.shields.io/badge/Ant_Design-5.x-0170FE?logo=antdesign) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb)

**MDE** 是一款基于 Tauri 2 + React + Monaco Editor 构建的跨平台 Markdown 编辑器，内置云端同步与用户认证体系。它将桌面应用的原生性能与现代 Web 技术的灵活性相结合，提供专业级的 Markdown 写作体验。

> ⚡ **Tauri 轻量优势**：基于 Rust + 系统 WebView 架构，打包体积极小，零运行时依赖。

---

## 🚀 核心特性

### 📝 Monaco 编辑器

- **专业级编辑体验**：VS Code 同款 Monaco Editor，完整的代码编辑能力
- **Shiki 语法高亮**：集成 Shiki 引擎，对 Markdown 代码块进行精准着色
- **多标签页**：同时打开多个文件，支持标签页拖动与滚动
- **分屏模式**：编辑、预览、左右分屏三种模式自由切换
- **浮动工具栏**：选中文本后弹出格式化快捷工具栏，一键加粗、插入链接等
- **快速搜索**：`Ctrl+P` 按文件名快速定位并打开

### 🔍 Markdown 实时预览

- **完整 GFM 支持**：表格、任务列表、删除线、脚注等 GitHub Flavored Markdown 语法
- **数学公式**：通过 `remark-math` + `rehype-katex` 渲染行内与块级 LaTeX 公式
- **Mermaid 图表**：内置 Mermaid 渲染器，支持流程图、时序图、甘特图等
- **代码高亮**：基于 rehype-highlight 的多语言代码块高亮
- **安全渲染**：集成 rehype-sanitize，防范 XSS 注入

### ☁️ 云端同步

- **账号体系**：JWT 认证登录，安全可靠
- **实时同步**：文件内容自动同步至服务端（NestJS + MongoDB）
- **冲突处理**：检测到编辑冲突时弹出对话框，支持本地/远端版本选择
- **同步状态指示器**：实时显示当前同步状态（同步中 / 已同步 / 离线）

### 🗂️ 侧边栏

- **资源管理器**：目录树浏览、新建文件、排序、在系统资源管理器中打开
- **文档大纲**：自动解析 Markdown 标题生成导航树，支持全部折叠 / 展开
- **最近文件**：快速访问历史打开记录，支持一键清空

### 🎨 界面体验

- **明暗主题**：一键切换，设置持久化
- **国际化**：完整的中英文界面支持（i18next）
- **自定义标题栏**：无边框窗口，原生拖动区域
- **文件统计面板**：字数、字符数、段落数等文档统计信息
- **Toast 通知**：轻量级操作反馈，不打断写作流

---

## 📦 安装

前往 [Releases](../../releases) 页面下载最新版本。

### Windows

- **EXE 安装程序** — 推荐，下载即装
- **MSI 安装包** — 适合需要系统集成（开始菜单、卸载）的场景

### macOS

根据芯片类型选择：

- **Apple Silicon (M 系列)** — `mde_x.x.x_aarch64.dmg`
- **Intel** — `mde_x.x.x_x64.dmg`

### Linux

- **Ubuntu / Debian** — `.deb` 包
- **Red Hat / Fedora** — `.rpm` 包
- **通用** — `.AppImage`（无需安装，直接运行）

---

## 📸 截图

| 浅色模式 | 深色模式 |
| -------- | -------- |
| ![浅色模式](images/light.png) | ![深色模式](images/dark.png) |

| 编辑 + 分屏预览 | Mermaid 图表 |
| --------------- | ------------ |
| ![分屏](images/split.png) | ![Mermaid](images/mermaid.png) |

| 资源管理器 & 大纲 | 云端同步登录 |
| ----------------- | ------------ |
| ![侧边栏](images/sidebar.png) | ![登录](images/login.png) |

---

## 🛠 技术架构

| 层级 | 技术组件 |
| ---- | -------- |
| **桌面层** | Tauri 2 (Rust) |
| **前端框架** | React 18 + Ant Design 5 |
| **编辑器** | Monaco Editor 0.52 + Shiki |
| **状态管理** | Zustand |
| **渲染管线** | react-markdown + remark-gfm + remark-math + rehype-katex + rehype-highlight |
| **图表** | Mermaid 11 |
| **国际化** | i18next + react-i18next |
| **构建工具** | Vite 6 + Tauri CLI 2 |
| **样式** | Sass + CSS Modules |
| **后端框架** | NestJS 10 |
| **数据库** | MongoDB（Mongoose 8） |
| **认证** | JWT + Passport（Local / JWT 策略） |

---

## 📂 项目结构

```
mde-tauri/
├── mde/                          # Tauri 桌面端
│   ├── src/                      # React 前端源码
│   │   ├── components/
│   │   │   ├── editor/           # 编辑器核心组件
│   │   │   │   ├── MonacoEditor.jsx        # Monaco 编辑器封装
│   │   │   │   ├── MarkdownPreview.jsx     # Markdown 渲染预览
│   │   │   │   ├── FloatingToolbar.jsx     # 浮动格式工具栏
│   │   │   │   └── MermaidRenderer.jsx     # Mermaid 图表渲染
│   │   │   ├── layout/           # 布局组件
│   │   │   │   ├── sidebar/      # 侧边栏（资源管理器 / 大纲 / 最近）
│   │   │   │   ├── tab-bar/      # 标签页栏
│   │   │   │   ├── title-bar/    # 自定义标题栏
│   │   │   │   ├── content/      # 主内容区
│   │   │   │   └── footer/       # 状态栏
│   │   │   ├── overlays/         # 弹出层
│   │   │   │   ├── LoginModal.jsx          # 登录弹窗
│   │   │   │   ├── SettingsModal.jsx       # 设置弹窗
│   │   │   │   ├── SearchModal.jsx         # 文件搜索弹窗
│   │   │   │   ├── ConflictDialog.jsx      # 同步冲突处理
│   │   │   │   └── StatsPanel.jsx          # 文档统计面板
│   │   │   └── ui/               # 通用 UI 原子组件
│   │   │       ├── SyncStatusIndicator.jsx # 同步状态指示器
│   │   │       ├── UserMenu.jsx            # 用户菜单
│   │   │       └── Toast.jsx               # 通知组件
│   │   ├── store/                # Zustand 状态仓库
│   │   │   ├── useEditorStore.js           # 编辑器状态
│   │   │   ├── useFileStore.js             # 文件管理状态
│   │   │   ├── useAuthStore.js             # 认证状态
│   │   │   ├── useThemeStore.js            # 主题状态
│   │   │   ├── useConfigStore.js           # 配置状态
│   │   │   └── useNotificationStore.js     # 通知状态
│   │   ├── services/
│   │   │   ├── apiClient.js                # HTTP 客户端
│   │   │   └── syncEngine.js               # 云端同步引擎
│   │   ├── hooks/
│   │   │   └── useFileManager.js           # 文件操作 Hook
│   │   ├── utils/                # 工具函数
│   │   ├── i18n/                 # 国际化资源（zh_cn / en_us）
│   │   ├── configs/              # 运行时配置
│   │   ├── App.jsx               # 根组件
│   │   └── main.jsx              # 应用入口
│   ├── src-tauri/                # Tauri 后端（Rust）
│   │   ├── src/                  # Rust 源码
│   │   ├── icons/                # 应用图标
│   │   ├── Cargo.toml            # Rust 依赖
│   │   └── tauri.conf.json       # Tauri 配置
│   ├── public/                   # 静态资源
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── mde-server/                   # NestJS 云端服务
    ├── src/
    │   ├── auth/                 # JWT 认证模块（Local / JWT 策略）
    │   ├── users/                # 用户模块
    │   ├── sync/                 # 文件同步模块
    │   ├── schemas/              # Mongoose Schema 定义
    │   ├── app.module.ts         # 根模块
    │   └── main.ts               # 服务入口
    ├── .env.example              # 环境变量示例
    ├── nest-cli.json
    ├── tsconfig.json
    └── package.json
```

---

## 🛠️ 开发环境搭建

### 前置要求

| 工具 | 最低版本 | 说明 |
| ---- | -------- | ---- |
| Node.js | 18.0+ | 前端构建 |
| Rust | 1.77+ | Tauri 编译 |
| MongoDB | 6.0+ | 数据库（本地或 Atlas） |
| WebView2 | — | Windows 10+ 已内置 |

### 安装 Rust 与 Tauri CLI

```bash
# 安装 Rust（macOS / Linux）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 Tauri CLI
cargo install tauri-cli --version "^2"
```

### 启动前端（mde）

```bash
cd mde

# 安装依赖
npm install

# 开发模式（同时启动 Vite 和 Tauri 窗口）
npm run tauri:dev

# 仅启动 Vite（不打开 Tauri 窗口）
npm run dev
```

### 启动后端（mde-server）

```bash
cd mde-server

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 MongoDB 连接字符串与 JWT 密钥

# 开发模式（热重载）
npm run start:dev

# 生产模式
npm run build && npm run start:prod
```

### 构建桌面应用

```bash
cd mde

# 构建所有平台格式
npm run tauri:build

# 产物位于 src-tauri/target/release/bundle/
```

---

## ⚙️ 配置说明

### 客户端（mde）

设置通过 Tauri Store 插件持久化，在应用内「设置」面板中配置：

- **服务器地址**：云端同步 API 的 Base URL
- **主题**：明 / 暗模式，启动时自动恢复
- **语言**：中文 / 英文，实时切换
- **编辑器**：字体大小、Word Wrap、自动保存等

### 服务端（mde-server）

通过 `.env` 文件配置：

```env
MONGODB_URI=mongodb://localhost:27017/mde
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
PORT=3000
```

---

## 🤝 贡献指南

欢迎通过 GitHub 提交 PR：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/your-feature`)
3. 提交代码 (`git commit -m 'feat: 添加某某特性'`)
4. 推送到远端 (`git push origin feature/your-feature`)
5. 创建 Pull Request

提交信息请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

---

## 📄 许可证

本项目采用 MIT 许可证 — 查看 [LICENSE](LICENSE) 文件了解详情。

---

## 🙏 致谢

- [Tauri](https://tauri.app/) — 现代跨平台桌面框架
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — VS Code 同款编辑器内核
- [React](https://react.dev/) — 用户界面库
- [Ant Design](https://ant.design/) — 企业级 UI 组件库
- [Mermaid](https://mermaid.js.org/) — 文本驱动的图表库
- [NestJS](https://nestjs.com/) — 渐进式 Node.js 框架
- [Shiki](https://shiki.style/) — 精准语法高亮引擎

---

**MDE** — 专注写作，其余交给编辑器。✨
