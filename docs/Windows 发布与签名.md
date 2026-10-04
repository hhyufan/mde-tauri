# Windows 构建与签名

## 窗口无法出现

从 2026-09-30 起，主窗口在 Tauri 创建时直接显示。旧构建把窗口设为隐藏，依赖 `index.html` 中的 JavaScript 调用 `show_main_window`；该调用失败时，`mde.exe` 进程会一直存在，但桌面上没有窗口。修改后即使前端初始化失败，启动错误也会显示在窗口中。

构建后先运行 `src-tauri/target/release/mde.exe` 验证主窗口，再安装 `src-tauri/target/release/bundle/nsis` 中的新安装包。旧安装目录中的 `mde.exe` 不会因重新构建而自动更新。

普通本地构建默认不生成 Tauri 自动更新包，因此不需要更新签名私钥；正式 Release 工作流会打开更新包生成，并要求更新签名密钥。`npm run tauri build` 生成的本地 exe 和安装包仍是未签名的开发产物。

## 仅发布版高亮和输入区域异常

Tauri 在打包后的 `style-src` 中追加 nonce。浏览器遇到 nonce 后会忽略同一指令中的 `unsafe-inline`，导致 Monaco 的动态主题样式、行布局样式和输入区域布局被拦截。Shiki 的 Oniguruma 引擎也需要 WebAssembly，但只有 `script-src 'self'` 时会被 CSP 阻止初始化。

配置中显式区分 `style-src-elem` 和 `style-src-attr`，允许编辑器所需的运行时样式；脚本仅增加 `wasm-unsafe-eval`，不开放 JavaScript `unsafe-eval`。保留 Tauri 原有的脚本 hash/nonce 注入和其余 CSP 限制。参见 [Tauri CSP 文档](https://v2.tauri.app/security/csp/)。

回归时运行 `npm run build` 和 `npm run preview:editor:production`，打开 `http://127.0.0.1:4174/`。此页面使用 `dist` 中的实际 Monaco/Shiki 资源，并模拟 Tauri 追加样式 nonce 后的 CSP；应显示 `highlighterReady: true`，源码各行不能重叠，Markdown 内的 JS 代码块应有颜色，诊断区不能出现 `CSP:` 拦截记录。输入区支持手动验证中文候选词和组合事件。这是浏览器层验证，发布前还需要打开新编译的 exe 确认原生 WebView2 的输入法候选窗。

## 保存触发外部版本冲突

保存和文件监听检查共用同一文件的操作队列，保存返回前登记实际写入的正文。监听事件只作为重新读盘的信号，不将事件中的时间戳与后来读出的正文拼成版本。保存期间继续输入的内容保留未保存标记；延迟执行的自动保存读取当前缓冲区。

输入法组词期间暂停监听检查和本地自动保存。原子替换的删除、重命名事件先合并，读不到文件时再复查。真正的外部冲突和云同步冲突只显示提示条，点击“查看并处理”才打开可关闭的对话框；待处理版本仍受覆盖保护。

## ring、vswhom-sys 编译失败或缺少 libcmt.lib

本机同时安装的 Community 和 Build Tools 中，Community 缺少标准头文件和 `lib/x64`。Rust 自动选择它时，可能报 `ring` / `vswhom-sys` 的 C/C++ 编译错误，或 `LNK1104: libcmt.lib`。

项目的 Tauri 启动脚本会检查安装目录中的编译器、链接器、`vcruntime.h` 和 `libcmt.lib`，跳过不完整的工具链，初始化完整安装的开发环境，并向 Cargo / cc-rs 指定该安装的编译器和链接器。在普通 PowerShell 中直接运行：

```powershell
npm run tauri build
# 只生成 NSIS 安装包：
npm run tauri:build:nsis
```

不需要手动运行 `vcvars64.bat` 或修改系统环境变量。若所有安装都不完整，脚本会提示在 Visual Studio Installer 中安装“使用 C++ 的桌面开发”和 Windows SDK。`npm run test:build-tools` 验证不完整安装的回退选择。

如果受限构建沙箱中 MSI 打包报 `LGHT0217`，并明确提示无法访问 Windows Installer 服务，应在能访问该服务的正常构建环境执行；这与 MSVC 缺失是不同问题。NSIS 打包不依赖这项 MSI 校验。

## Authenticode 与 Tauri 更新签名

`TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_UPDATER_PUBLIC_KEY` 只保护 Tauri 更新包；它们不会给 Windows 可执行文件签名。需要 Windows 代码签名证书，且证书私钥必须可用于构建环境。

本地签名可在当前用户证书存储中安装有效的代码签名证书，然后在 PowerShell 中设置构建覆盖配置：

```powershell
$env:TAURI_CONFIG = '{"bundle":{"windows":{"certificateThumbprint":"证书指纹","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com"}}}'
npm run tauri build
Get-AuthenticodeSignature -LiteralPath src-tauri/target/release/mde.exe
Get-AuthenticodeSignature -LiteralPath src-tauri/target/release/bundle/nsis/mde_0.1.0_x64-setup.exe
```

两个签名状态都应为 `Valid`。正式 Release 工作流要求 `WINDOWS_CERTIFICATE`（PFX 的 Base64 内容）、`WINDOWS_CERTIFICATE_PASSWORD`、`TAURI_UPDATER_PUBLIC_KEY` 和原有的 Tauri 更新签名私钥。它会导入证书、给 Tauri CLI 提供签名配置，并验证 exe、NSIS 和 MSI 的 Authenticode 签名。缺少证书时工作流会失败，避免误把未签名安装包作为正式版发布。

## Windows 安全提示

SmartScreen 的“未知发布者 / 不常下载”提示与 Defender Antivirus 的恶意软件检测是不同机制。可信代码签名可显示发布者并逐步积累信誉；新签名的版本仍可能有 SmartScreen 提示，自签名证书也不能替代可信发布者证书。若 Defender 实际报告误报，保留检测名称和**确切版本的安装包**，使用 [Microsoft 文件分析入口](https://www.microsoft.com/en-us/wdsi/filesubmission)按 Software developer 身份提交。发布前不要修改已经签名的文件。

参考：[Tauri Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)、[Microsoft SmartScreen 信誉说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)、[Microsoft 软件开发者误报说明](https://learn.microsoft.com/en-us/defender-xdr/developer-faq)。
