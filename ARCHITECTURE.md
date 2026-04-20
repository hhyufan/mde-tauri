# mde-tauri 项目架构与逐文件注释报告

- 生成时间: 2026-04-20 10:52:22
- 代码仓库根目录: `c:\Code\React\mde-tauri`
- 目的: 让新成员可以快速理解三层架构、关键数据流，并按文件定位职责。

## 1. 架构总览
- 三层架构: React 前端（交互+状态） + Tauri Rust（本地系统能力） + NestJS 后端（认证+云同步）。
- 前端通过 `@utils/tauriApi` 调用本地命令，通过 `@/services/apiClient` 调用 `/auth/*` 与 `/sync/*`。
- 同步模型采用 `fileId + rev/baseRev + mutation queue`，并通过冲突弹窗进行人工决策。

## 2. 分层职责
### 2.1 前端层（`src/`）
- 视图层: `components/` 负责编辑器、侧栏、标签栏、弹窗、状态提示。
- 状态层: `store/` 使用 Zustand 管理编辑状态、认证、同步、书签、fileId 映射。
- 业务层: `services/syncEngine.js` 是同步中枢，`hooks/useFileManager.js` 负责文件生命周期。

### 2.2 桌面能力层（`src-tauri/`）
- `src/lib.rs` 提供文件读写、目录扫描、重命名/删除、文件监听、执行与搜索命令。
- `capabilities/default.json` 与 `tauri.conf.json` 约束窗口行为和可调用权限。

### 2.3 云服务层（`mde-server/`）
- `auth` 模块负责登录注册/JWT。
- `sync` 模块负责文档 upsert/pull/delete、变更游标、设备路径绑定与配置同步。
- `schemas` 定义 `User`、`SyncDocument`、`SyncConfig` 持久化结构。

## 3. 关键数据流
1. 编辑保存: Monaco 编辑 -> buffer/dirty -> 本地 saveFile -> queueLocalUpsert 入队。
2. 同步上传: queue -> processMutation -> `/sync/file/:fileId` -> rev 前进。
3. 同步下行: `/sync/changes` -> 拉取全文 -> 覆盖前本地变更检测 -> 冲突或落盘。
4. 冲突处理: 进入 `useSyncStore.conflicts` -> `ConflictDialog` 选择保留本地或采用远端。
5. 鉴权续期: 请求 401 -> `/auth/refresh` -> 重放原请求。

## 4. 文件注释策略说明
- 本报告中的“逐文件注释”对**仓库全部已跟踪文件**都给出用途说明。
- 对二进制文件（图片/图标/设计稿/docx）提供职责说明，不做行内代码注释。
- 对 JSON/TOML/LOCK 等解析敏感文件，仅做语义说明，避免破坏格式。

## 5. 逐文件注释清单
| 文件 | 注释 |
|---|---|
| `.cursor/plans/mde-tauri_椤圭洰璁″垝涔4d37651a.plan.md` | 项目文档文件。 |
| `.gitattributes` | 项目文件（建议结合所在目录语义阅读）。 |
| `.gitignore` | 项目文件（建议结合所在目录语义阅读）。 |
| `README.md` | 项目文档文件。 |
| `UI/Notification.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/Root-Settings.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/Root.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/Sidebar-Outline.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/Sidebar-Recent.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/Task Panel.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/Toolbar.png` | 二进制资源文件：不适合行内代码注释。 |
| `UI/md-editor.html` | 静态页面/模板文件。 |
| `index.html` | 静态页面/模板文件。 |
| `mde-server/.env.example` | 项目文件（建议结合所在目录语义阅读）。 |
| `mde-server/.gitignore` | 项目文件（建议结合所在目录语义阅读）。 |
| `mde-server/.vercelignore` | 项目文件（建议结合所在目录语义阅读）。 |
| `mde-server/Dockerfile` | 项目文件（建议结合所在目录语义阅读）。 |
| `mde-server/VERCEL.md` | 项目文档文件。 |
| `mde-server/nest-cli.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `mde-server/package-lock.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `mde-server/package.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `mde-server/src/app.module.ts` | 后端模块装配入口（Auth/Sync/Users/Mongoose）。 |
| `mde-server/src/auth/auth.controller.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/auth.module.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/auth.service.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/dto/login.dto.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/dto/register.dto.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/guards/jwt-auth.guard.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/strategies/jwt.strategy.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/auth/strategies/local.strategy.ts` | 鉴权模块（注册、登录、JWT 策略与守卫）。 |
| `mde-server/src/main.ts` | NestJS 服务启动与中间件装配入口。 |
| `mde-server/src/schemas/sync-config.schema.ts` | Mongo 文档 Schema 定义。 |
| `mde-server/src/schemas/sync-document.schema.ts` | Mongo 文档 Schema 定义。 |
| `mde-server/src/setup.ts` | TypeScript 源码文件。 |
| `mde-server/src/sync/dto/index.ts` | 同步 API、DTO 与服务实现（rev/baseRev 冲突控制）。 |
| `mde-server/src/sync/dto/pull.dto.ts` | 同步 API、DTO 与服务实现（rev/baseRev 冲突控制）。 |
| `mde-server/src/sync/dto/push.dto.ts` | 同步 API、DTO 与服务实现（rev/baseRev 冲突控制）。 |
| `mde-server/src/sync/sync.controller.ts` | 同步 API、DTO 与服务实现（rev/baseRev 冲突控制）。 |
| `mde-server/src/sync/sync.module.ts` | 同步 API、DTO 与服务实现（rev/baseRev 冲突控制）。 |
| `mde-server/src/sync/sync.service.ts` | 同步 API、DTO 与服务实现（rev/baseRev 冲突控制）。 |
| `mde-server/src/users/schemas/user.schema.ts` | 用户模型与用户服务。 |
| `mde-server/src/users/users.module.ts` | 用户模型与用户服务。 |
| `mde-server/src/users/users.service.ts` | 用户模型与用户服务。 |
| `mde-server/tsconfig.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `mde-server/vercel.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `package-lock.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `package.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `postcss.config.js` | JavaScript 源码文件。 |
| `public/prism-one-dark.css` | 项目文件（建议结合所在目录语义阅读）。 |
| `public/prism-one-light.css` | 项目文件（建议结合所在目录语义阅读）。 |
| `sketch/md-editor 2 Dark Mode (1).sketch` | 二进制资源文件：不适合行内代码注释。 |
| `sketch/md-editor 2 LIght Mode (1).sketch` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/Cargo.lock` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `src-tauri/Cargo.toml` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `src-tauri/build.rs` | Rust 源码文件。 |
| `src-tauri/capabilities/default.json` | Tauri 能力权限清单。 |
| `src-tauri/icons/128x128.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/128x128@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/32x32.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/64x64.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square107x107Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square142x142Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square150x150Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square284x284Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square30x30Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square310x310Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square44x44Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square71x71Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/Square89x89Logo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/StoreLogo.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/icon.icns` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/icon.ico` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/icon.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/icon_new.ico` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-20x20@1x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-20x20@2x-1.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-20x20@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-20x20@3x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-29x29@1x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-29x29@2x-1.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-29x29@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-29x29@3x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-40x40@1x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-40x40@2x-1.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-40x40@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-40x40@3x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-512@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-60x60@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-60x60@3x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-76x76@1x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-76x76@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/icons/ios/AppIcon-83.5x83.5@2x.png` | 二进制资源文件：不适合行内代码注释。 |
| `src-tauri/src/lib.rs` | Tauri 命令实现：文件系统、监控、执行与搜索能力。 |
| `src-tauri/src/main.rs` | Tauri 应用启动入口。 |
| `src-tauri/tauri.conf.json` | Tauri 窗口与打包配置。 |
| `src/App.jsx` | 应用主编排：布局、弹窗、同步状态联动。 |
| `src/assets/styles/App.scss` | 样式文件。 |
| `src/assets/styles/index.scss` | 样式文件。 |
| `src/components/editor/FloatingToolbar.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/editor/LazyMonacoEditor.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/editor/MarkdownPreview.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/editor/MermaidRenderer.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/editor/MonacoEditor.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/editor/floating-toolbar.scss` | 组件样式定义。 |
| `src/components/editor/markdown-preview.scss` | 组件样式定义。 |
| `src/components/editor/monaco-editor.scss` | 组件样式定义。 |
| `src/components/layout/content/EditorContent.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/content/editor-content.scss` | 组件样式定义。 |
| `src/components/layout/footer/Footer.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/footer/footer.scss` | 组件样式定义。 |
| `src/components/layout/sidebar/Sidebar.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/sidebar/explorer/FileTree.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/sidebar/explorer/file-tree.scss` | 组件样式定义。 |
| `src/components/layout/sidebar/outline/OutlineView.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/sidebar/outline/outline.scss` | 组件样式定义。 |
| `src/components/layout/sidebar/sidebar.scss` | 组件样式定义。 |
| `src/components/layout/tab-bar/TabBar.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/tab-bar/tabbar.scss` | 组件样式定义。 |
| `src/components/layout/title-bar/TitleBar.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/layout/title-bar/titlebar.scss` | 组件样式定义。 |
| `src/components/notification/NotificationContainer.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/notification/notification.scss` | 组件样式定义。 |
| `src/components/overlays/ConflictDialog.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/overlays/LoginModal.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/overlays/SearchModal.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/overlays/SettingsModal.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/overlays/StatsPanel.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/overlays/conflict-dialog.scss` | 组件样式定义。 |
| `src/components/overlays/login-modal.scss` | 组件样式定义。 |
| `src/components/overlays/search-modal.scss` | 组件样式定义。 |
| `src/components/overlays/settings-modal.scss` | 组件样式定义。 |
| `src/components/overlays/stats-panel.scss` | 组件样式定义。 |
| `src/components/ui/SyncStatusIndicator.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/ui/Toast.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/ui/UserMenu.jsx` | 前端 UI 组件：编辑器、布局、弹窗、状态提示等。 |
| `src/components/ui/sync-status.scss` | 组件样式定义。 |
| `src/components/ui/toast.scss` | 组件样式定义。 |
| `src/components/ui/user-menu.scss` | 组件样式定义。 |
| `src/configs/file-extensions.json` | 配置/锁文件：为保证解析安全，不建议写注释。 |
| `src/hooks/useEditorBufferContent.js` | JavaScript 源码文件。 |
| `src/hooks/useFileManager.js` | 文件打开/保存/另存为/自动保存入口，并桥接同步引擎。 |
| `src/i18n/index.js` | 国际化资源与初始化。 |
| `src/i18n/locales/en_us.json` | 国际化资源与初始化。 |
| `src/i18n/locales/zh_cn.json` | 国际化资源与初始化。 |
| `src/main.jsx` | 前端应用启动入口。 |
| `src/monaco-worker.js` | JavaScript 源码文件。 |
| `src/services/apiClient.js` | HTTP 客户端与鉴权拦截、401 刷新与同步接口缓存策略。 |
| `src/services/syncEngine.js` | 云同步核心引擎：队列、拉取、冲突、版本控制。 |
| `src/store/useAuthStore.js` | 登录态持久化：token、user、登录/登出流程。 |
| `src/store/useConfigStore.js` | JavaScript 源码文件。 |
| `src/store/useDeviceStore.js` | JavaScript 源码文件。 |
| `src/store/useEditorStore.js` | 编辑器标签、缓冲与脏状态管理（Zustand）。 |
| `src/store/useExternalDocsStore.js` | 仅云端文档缓存与元信息。 |
| `src/store/useFileIdStore.js` | 本地路径与云 fileId 映射关系。 |
| `src/store/useFileStore.js` | 文件浏览、最近文件、书签状态。 |
| `src/store/useNotificationStore.js` | JavaScript 源码文件。 |
| `src/store/useSyncStore.js` | 同步状态仓：docs、queue、conflicts、cursor。 |
| `src/store/useThemeStore.js` | JavaScript 源码文件。 |
| `src/store/useToastStore.js` | JavaScript 源码文件。 |
| `src/utils/classNames.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `src/utils/debounce.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `src/utils/editorBuffer.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `src/utils/fileLanguage.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `src/utils/footnoteParser.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `src/utils/pathUtils.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `src/utils/tauriApi.js` | 通用工具函数（路径、防抖、缓冲、语言映射等）。 |
| `vite.config.js` | JavaScript 源码文件。 |
| `~$_鍩轰簬Tauri鐨凪arkdown缂栬緫鍣?docx` | 项目文件（建议结合所在目录语义阅读）。 |

