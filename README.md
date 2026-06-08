# MDE · Markdown Editor

**语言 / Language**: 中文 | [English](README_EN.md)

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Vite](https://img.shields.io/badge/Vite-6.2.4-646CFF?logo=vite) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb)

**MDE** 是一个基于 Tauri 2 + React + Monaco Editor + Milkdown 的跨平台 Markdown 编辑器，围绕“本地文件管理 + Markdown 多视图编辑 + 云同步”构建，支持资源管理器、大纲、最近文件、实时预览、所见即所得、设置中心与冲突处理。

> ⚡ 基于 Rust + 系统 WebView，桌面端轻量、启动快、打包体积小。

***

## 🚀 当前功能点（与最新页面同步）

### 🖥️ 工作台界面

- **单页工作台布局**：左侧边栏、顶部标题栏、标签栏、主编辑区、底部状态栏组成完整桌面式写作界面。
- **桌面 / 移动端自适应**：移动端自动切换窄屏布局，侧栏改为抽屉式交互，并兼容安全区与横竖屏。
- **自定义标题栏**：集成侧栏切换、搜索入口、最小化 / 最大化 / 关闭窗口等桌面能力。

### ✍️ 编辑与预览

- **Monaco 源码编辑**：适合代码式 Markdown 编辑，支持语法高亮、右键菜单、光标定位与常规编辑行为。
- **Milkdown 所见即所得**：支持任务列表点击切换、表格/图片/公式/代码块在源码态与渲染态之间切换。
- **三种视图模式**：编辑 / 预览 / 分屏，Markdown 文件可在源码、WYSIWYG 和预览之间切换，非 Markdown 文件自动走回退逻辑。
- **浮动工具栏**：粗体、斜体、删除线、标题、引用、表格、代码块、链接、图片、任务列表、分隔线等快捷插入。
- **分屏联动**：支持分栏拖拽比例、编辑区到预览区滚动同步，以及“预览跟随编辑器缩放”。

### 🔍 Markdown 能力

- **GFM 支持**：表格、任务列表、删除线、脚注等常见 Markdown 扩展语法。
- **数学公式**：支持 LaTeX 公式渲染。
- **Mermaid 图表**：直接渲染 `mermaid` 代码块。
- **代码高亮与复制**：预览和 WYSIWYG 里的代码块支持语言标识、预览与复制。
- **增强链接体验**：支持 Markdown 相对链接、应用内打开、按 `#Lxx` / `Lxx~xx` 行号提示跳转。
- **大纲联动跳转**：标题与列表结构可同步到大纲面板，点击后联动到编辑区或预览区。

### 📁 文件与工作区

- **资源管理器**：目录浏览、面包屑导航、前进/后退、上一级、刷新、排序、关闭目录。
- **文件操作**：打开文件、打开文件夹、资源管理器内联新建文件、保存、另存为、重命名、删除。
- **多标签页工作流**：支持新建、切换、关闭、滚动浏览、重命名和未保存状态提示。
- **最近文件 / 书签 / 云文档聚合**：最近打开记录、书签优先排序，并能直接进入仅云端文档。
- **拖拽交互**：拖到编辑区直接打开，拖到资源管理器可移动到当前目录并自动打开。
- **系统文件管理器联动**：桌面端支持在系统资源管理器中定位当前文件或目录。

### 🔎 搜索与统计

- **全局搜索**：`Ctrl+P` 打开搜索弹窗，支持按文件名搜索与 Markdown 内容搜索。
- **命中跳转**：内容搜索支持命中行定位，打开后可直接跳转到对应位置。
- **统计面板**：展示打开文件数、最近文件数、总字数 / 字符数、文件类型分布等。

### ☁️ 云同步（文档 + 设置）

- **账号体系**：注册 / 登录 / JWT 鉴权。
- **文档同步引擎**：基于 `fileId + rev/baseRev + mutation queue` 的增量同步模型。
- **同步绑定策略**：本地文件在收藏或已绑定 `fileId` 后参与云同步。
- **云端仅文档支持**：支持 `cloud://<fileId>` 形式的云文档打开，并在首次落盘后认领到本地路径。
- **冲突处理**：冲突时提供双栏对比，可选择保留本地或采用远端版本。
- **设置同步**：主题、编辑器配置、布局状态等可同步到云端，并支持从云端拉取覆盖本地。
- **设置导入导出**：支持设置 JSON 导出 / 导入。

### 🎨 个性化与系统体验

- **明暗主题切换**：主题持久化，并带有过渡动画。
- **国际化**：中英双语界面（i18next）。
- **设置中心**：语言、工作区、编辑器、预览缩放、云同步、JSON 导入导出等集中配置。
- **自动保存与关闭保护**：支持自动保存、未保存文件勾选保存后再关闭窗口。
- **通知系统**：Toast + Notification 双通道反馈。

***

## ⌨️ 常用快捷键

- `Ctrl+P`：打开文件搜索 / 内容搜索
- `Ctrl+S`：保存当前文件
- `Ctrl+O`：打开文件或目录
- `Ctrl+,`：打开设置
- `Ctrl+B`：切换侧栏显示
- `Ctrl+Shift+/`：编辑与预览模式切换
- `Esc`：关闭搜索/设置/登录弹窗

***

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

***

## 🛠 技术栈

| 层级          | 技术                                                                         |
| ----------- | -------------------------------------------------------------------------- |
| 桌面壳         | Tauri 2（Rust）                                                              |
| 前端          | React 18 + Ant Design 5 + Zustand                                          |
| 编辑器         | Monaco Editor + Milkdown + Prism / Shiki                                  |
| Markdown 渲染 | react-markdown + Milkdown + remark-gfm + remark-math + rehype-katex + rehype-sanitize |
| 图表          | Mermaid                                                                    |
| 国际化         | i18next + react-i18next                                                    |
| 构建          | Vite 6 + Tauri CLI 2                                                       |
| 服务端         | NestJS 10 + Mongoose 8                                                     |
| 数据库         | MongoDB                                                                    |
| 认证          | JWT + Passport（Local/JWT Strategy）                                         |

***

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

***

## 🛠️ 开发环境

### 前置要求

| 工具                         | 建议版本            | 说明                   |
| -------------------------- | --------------- | -------------------- |
| Node.js                    | 18+             | 前后端依赖安装与构建           |
| Rust                       | 1.77+           | Tauri 编译             |
| Android Studio / SDK / NDK | Android SDK 35+ | Android APK 构建       |
| JDK                        | 17 - 21         | Gradle / Android 构建  |
| MongoDB                    | 6+              | 服务端存储                |
| WebView2                   | 系统自带            | Windows 下 Tauri 运行环境 |

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

### 4) 构建 Android APK

首次构建前需要安装 Android Studio，并在 Android Studio 中安装 SDK、NDK、Build Tools；同时确保 `JAVA_HOME`、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 指向本机环境。

```bash
# 首次生成 Android 工程
npm run tauri:android:init

# 连接真机或启动模拟器进行调试
npm run tauri:android:dev

# 生成 APK
npm run tauri:android:build

# 常见 APK 输出目录
# src-tauri/gen/android/app/build/outputs/apk/
```

移动端版本会自动启用窄屏布局：侧栏改为抽屉、标题栏隐藏桌面窗口按钮、分屏编辑改为上下布局。Android 受系统沙盒限制，文件系统能力通过 SAF（Storage Access Framework）适配，任意本机目录浏览、系统资源管理器打开、脚本执行等桌面能力会降级或不可用。

***

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

***

## 🤝 贡献指南

欢迎通过 PR 参与改进：

1. Fork 本仓库
2. 创建分支：`git checkout -b feature/xxx`
3. 提交代码：`git commit -m "feat: xxx"`
4. 推送分支：`git push origin feature/xxx`
5. 创建 Pull Request

建议遵循 [Conventional Commits](https://www.conventionalcommits.org/)。

***

## 📄 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。

***

**MDE** — 专注写作，把复杂交给工具。
