# MDE (Markdown Editor) Code Wiki

本文档旨在为 MDE（Markdown Editor）项目提供全面、结构化的代码架构与实现指南。MDE 是一个基于 Tauri 2 + React + Monaco Editor + Milkdown 构建的跨平台 Markdown 编辑器，支持本地文件管理、多视图编辑及增量云同步。

---

## 1. 项目整体架构

MDE 项目采用**客户端-云端**混合架构。客户端是一个依托 Tauri 的跨平台桌面/移动应用，云端则是一个基于 NestJS 的同步服务。

- **前端层 (React + Vite)**：负责用户界面、编辑器交互、状态管理以及同步逻辑的调度。
- **本地宿主层 (Tauri/Rust)**：通过系统 WebView 渲染前端，并利用 Rust 提供系统级的文件 I/O、文件变化监听、本地命令执行等能力。
- **云端服务层 (NestJS + MongoDB)**：处理用户鉴权、文档的版本化增量同步以及用户配置同步。

### 核心数据流
1. **本地文件读写**：前端通过 Tauri IPC 调用 `src-tauri` 中的 Rust 函数，实现无浏览器的沙盒文件操作限制。
2. **状态与配置同步**：前端 `SyncEngine` 与后端 NestJS 交互，使用 `fileId` 和 `rev` (版本号) 实现增量同步及冲突检测。

---

## 2. 目录结构

项目在代码组织上划分为三大核心部分：

```text
mde-tauri/
├── src/                      # React 前端源码
│   ├── antd/                 # Ant Design 主题与组件覆盖
│   ├── assets/               # 字体与全局样式 (SCSS)
│   ├── components/           # 核心 UI 组件（编辑器、布局、弹窗等）
│   ├── configs/              # 静态配置（如 file-extensions）
│   ├── hooks/                # 业务自定义 Hooks
│   ├── i18n/                 # 国际化语言包 (zh_cn, en_us)
│   ├── services/             # API 请求 (apiClient) 与同步引擎 (syncEngine)
│   ├── store/                # Zustand 状态管理
│   ├── utils/                # 跨平台工具类、Tauri API 封装
│   └── App.jsx / main.jsx    # 前端生命周期入口
├── src-tauri/                # Tauri Rust 侧（系统宿主）
│   ├── src/
│   │   ├── main.rs           # 二进制启动入口
│   │   └── lib.rs            # 核心系统命令实现、文件系统与 IPC 桥接
│   ├── Cargo.toml            # Rust 依赖与构建配置
│   └── tauri.conf.json       # Tauri 应用及窗口配置
└── mde-server/               # NestJS 云同步服务端
    ├── src/
    │   ├── auth/             # JWT 鉴权与登录注册逻辑
    │   ├── schemas/          # MongoDB Mongoose 数据模型
    │   ├── sync/             # 云端同步业务逻辑（推/拉/冲突/重置）
    │   ├── users/            # 用户信息管理
    │   └── main.ts           # 服务端入口 (兼容本地与 Vercel Serverless)
    └── package.json          # 服务端依赖
```

---

## 3. 主要模块职责

### 3.1 前端模块 (React)
- **UI 布局 (`src/components/layout/`)**：负责侧边栏 (Sidebar)、标签页 (TabBar)、底部状态栏 (Footer) 等框架结构的装配。
- **编辑器模块 (`src/components/editor/`)**：封装 Monaco Editor (源码模式) 和 Milkdown (所见即所得模式)，处理语法高亮、预览与实时输入。
- **状态管理 (`src/store/`)**：基于 Zustand，拆分为 `useEditorStore` (编辑器状态), `useFileStore` (文件树状态), `useSyncStore` (云同步状态), `useConfigStore` (应用配置) 等，负责应用状态的内存维系。
- **文件管理器 (`src/hooks/useFileManager.js`)**：桥接 Zustand 与 Tauri API，处理文件的打开、保存、目录加载与拖拽行为。

### 3.2 本地宿主模块 (Rust / Tauri)
- **文件操作**：绕过前端安全限制，直接使用 Rust `std::fs` 提供文件读写、二进制文件加载、重命名和删除功能。
- **系统监听 (`notify`)**：监听用户工作区的文件系统变动，发生修改时通过 Tauri Event 向前端派发 `file-changed` 事件。
- **系统交互**：包含打开系统文件管理器 (`show_in_explorer`)、运行代码片段 (`run_code_snippet`) 等底层接口。

### 3.3 云同步模块 (NestJS)
- **认证模块 (`auth`)**：提供 JWT 令牌生成与 Local Strategy (用户名密码) 登录验证。
- **同步模块 (`sync`)**：处理 `manifest` (云端目录清单获取)、`changes` (增量拉取)、`file` (单个文件推送/拉取)，并解决客户端的配置同步 (`config`) 请求。

---

## 4. 关键类与函数说明

### 4.1 前端关键类与函数
- **`App` 组件 (`src/App.jsx`)**：
  应用的根视图。统筹主题加载、快捷键绑定 (如 `Ctrl+S`, `Ctrl+P`)、窗口关闭前的未保存拦截，以及处理全局的拖拽交互。
- **`SyncEngine` 类 (`src/services/syncEngine.js`)**：
  核心同步调度器。包含 `push` (上报本地修改)、`pull` (拉取云端更新) 和 `resolveConflict` (处理冲突)。大文件会自动使用 `pako.gzip` 压缩并转为 base64 后上传。
- **`LazyMonacoEditor` (`src/components/editor/LazyMonacoEditor.jsx`)**：
  异步加载的 Monaco Editor 包装器。在编辑器实例创建前，先通过
  `src/utils/monacoRuntimeBoot.js` 完成 `mgtree` 语言注册与 Shiki 高亮初始化
  （TextMate 语法 + One Dark Pro / One Light 主题），再动态导入编辑器本体。
  顺序很关键：`shikiToMonaco` 会安装分词器并给 `monaco.editor.setTheme` / `create`
  打补丁，若在编辑器创建之后才执行，打包产物里就会退化成 Monaco 自带的 Monarch
  分词，围栏代码块不会有颜色。
  （Monaco 界面文案目前固定使用其内置英文；早期的 `monaco-editor-nls-adapter`
  构建期本地化方案已整体下线。）

### 4.2 Rust (Tauri) 关键函数 (`src-tauri/src/lib.rs`)
- **`read_file_content(path: String)`**：
  读取指定路径文件，自动推断文件编码（UTF-8 fallback）及换行符（CRLF/LF），返回标准化 `FileOperationResult`。
- **`save_file(file_path, content, encoding)`**：
  将前端文本内容按指定编码安全地持久化到磁盘，若父目录不存在则自动创建。
- **`start_file_watching(app_handle, file_path)`**：
  利用 `notify` crate 监听指定文件所在目录，发生修改时去重过滤后，通过 `app_handle.emit` 发发系统事件。
- **`search_files(dir_path, query, search_content)`**：
  提供高性能的本地文件检索。如果是内容搜索，则使用线程池 (`async_runtime::spawn_blocking`) 异步遍历目录并读取 Markdown 文件行，不阻塞主线程。

### 4.3 后端 (NestJS) 关键函数
- **`SyncController.pushFile` / `pullFile` (`mde-server/src/sync/sync.controller.ts`)**：
  单文件的版本化推拉接口，分别对应前端 `SyncEngine` 的上传和下载请求。
- **`SyncService.pushDocuments` (`mde-server/src/sync/sync.service.ts`)**：
  处理多文件批量上传更新，同时对文件内容进行去重 (Hash 校验)，并验证当前提交的版本号与数据库版本是否匹配，不匹配则抛出冲突 (ConflictException)。

---

## 5. 依赖关系

### 5.1 前端核心依赖 (`package.json`)
- **UI & 渲染**：`react`, `antd`, `react-markdown`, `mermaid`, `katex`
- **编辑器内核**：`monaco-editor`, `@milkdown/react`, `@milkdown/kit`, `@codemirror/view`
- **状态与工具**：`zustand`, `axios`, `i18next`, `pako` (用于压缩)
- **Tauri 桥接**：`@tauri-apps/api`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`

### 5.2 后端 Tauri 核心依赖 (`src-tauri/Cargo.toml`)
- **框架**：`tauri` (v2), `tauri-build`
- **序列化**：`serde`, `serde_json`
- **系统/文件**：`notify` (文件监听), `encoding_rs` (编码处理), `base64` (二进制传输)

### 5.3 云服务端依赖 (`mde-server/package.json`)
- **框架**：`@nestjs/core`, `@nestjs/common`, `express`
- **数据库**：`mongoose`, `@nestjs/mongoose`
- **认证加密**：`passport`, `@nestjs/passport`, `passport-jwt`, `bcrypt`

---

## 6. 项目运行与构建方式

### 6.1 前置环境
- Node.js 18+
- Rust 1.77+
- Android Studio / SDK 35+ (如果需要打包 Android APK)
- MongoDB 6+ (服务端存储)

### 6.2 启动桌面端开发环境
在仓库根目录 `mde-tauri/` 下执行：
```bash
# 1. 安装依赖
npm install

# 2. 启动纯前端模式（浏览器调试）
npm run dev

# 3. 启动 Tauri 桌面开发模式（结合 Rust 本地环境）
npm run tauri:dev
```

### 6.3 启动云同步服务 (mde-server)
```bash
# 1. 进入服务端目录
cd mde-server
npm install

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env 文件，配置 MONGODB_URI、JWT_SECRET 等参数

# 3. 启动开发服务器
npm run start:dev
```

### 6.4 编译与打包
```bash
# 回到项目根目录
cd ..

# 构建 Windows / macOS / Linux 桌面端安装包
# 产物输出于: src-tauri/target/release/bundle/
npm run tauri:build

# 构建 Android APK
npm run tauri:android:init   # 首次初始化
npm run tauri:android:build  # 构建正式版 APK
```
