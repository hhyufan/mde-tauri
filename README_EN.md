<p align="center">
  <img src="src/assets/characters/moki-icon.png" width="200" height="200" alt="MokiDown · Moki icon" />
</p>

<h1 align="center">MokiDown</h1>

<p align="center">A local-first Markdown workbench where writing, code, and knowledge live together.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react" alt="React 18.3.1" />
</p>

<p align="center">
  <a href="https://www.miaogu.xyz/">Live demo</a> ·
  <a href="https://github.com/hhyufan/mde-tauri/releases">Download</a> ·
  <a href="#-screenshots">Screenshots</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/Function/README.md">Feature docs</a> ·
  <a href="README.md">中文</a>
</p>

## Overview

MokiDown is an open-source Markdown editor built with Tauri 2, React, Monaco, and Milkdown. It reads and writes local files by default with no sign-in required; it can also connect to a self-hosted server to sync documents and settings.

<p align="center">
  <img src="screenshots/main.png" width="880" alt="MokiDown main window" />
</p>

## Features

- **Three editing modes**: source, WYSIWYG, and split view, with GFM, LaTeX math, and Mermaid diagrams.
- **Runnable code blocks**: on desktop, run C#, JavaScript, Python, Java, Kotlin, and Rust with output, interactive input, and stop; the matching language runtime must be installed.
- **Language services**: install LSP plugins on demand for completion, hover info, and diagnostics.
- **Knowledge trees**: organize note hierarchy with `.mgtree` files, with node editing and jumps to document code blocks.
- **Files and workspace**: multiple tabs, directory browsing, outline, global search, bookmarks, and auto-save.
- **Optional cloud sync**: sync documents and settings, and compare versions side by side when conflicts occur.
- **Personalization**: light and dark themes plus a Chinese/English interface.

## 📸 Screenshots

| Sunny note · Light welcome | Night read · Dark welcome |
| :---: | :---: |
| ![Light welcome](screenshots/welcome-light.png) | ![Dark welcome](screenshots/welcome-dark.png) |

| Three editing modes (source / WYSIWYG / split) | Running code blocks |
| :---: | :---: |
| ![Three editing modes](screenshots/editor.png) | ![Running code blocks](screenshots/code-run.png) |

| Cloud sync | Tree editor (mgtree) |
| :---: | :---: |
| ![Sync conflict](screenshots/sync-display.png) | ![Tree editor](screenshots/tree.png) |

| Dark editing | Appearance and character settings |
| :---: | :---: |
| ![Dark editing](screenshots/editor-dark.png) | ![Character settings](screenshots/moki-settings.png) |

Captured from the running application with sample documents. Code output and sync conflicts use demonstration data in the real components; these images do not indicate browser access to the desktop execution engine or a connected sync service. [Mobile welcome](screenshots/welcome-mobile.png) · [Design and capture notes](docs/character-design/moki-integration.md)

## Installation

See [Releases](https://github.com/hhyufan/mde-tauri/releases) for the available installers: on Windows the EXE (NSIS) is recommended, and the MSI also works. What other platforms ship depends on what each release actually provides.

The [live demo](https://www.miaogu.xyz/) shows the interface without installing; the browser demo cannot execute code locally the way the desktop app does. Android also differs in file access and local script execution.

## Quick start

### Local development

Prepare Node.js (22 is recommended, matching CI), a stable Rust toolchain, and the Tauri build dependencies for your platform. On Windows you also need the MSVC C++ toolchain, the Windows SDK, and WebView2.

From the repository root:

```bash
npm ci --legacy-peer-deps
npm run tauri:dev
```

To debug the frontend only, run `npm run dev`. Common commands:

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the frontend and the live-showcase entry |
| `npm run tauri:build` | Package the Windows desktop app (NSIS + MSI) |
| `npm run check` | Run lint, tests, build, and the bundle check |

Desktop installers are written to `src-tauri/target/release/bundle/`. Sample documents and code live in [examples](examples/README.md).

### Android build

Install Android Studio (SDK / NDK / Build Tools) and JDK 17–21, configure `JAVA_HOME` and `ANDROID_HOME`, then run:

```bash
npm run tauri:android:init
npm run tauri:android:build
```

### Self-hosted sync

Deploy the server by following the [mde-server](https://github.com/hhyufan/mde-server) instructions, then set the server URL under Settings → Cloud Sync in the client, sign in, bind documents, and enable sync.

## Docs and contributing

- [Feature docs](docs/Function/README.md) · [Language services](docs/语言服务.md) · [Local script execution](docs/本地脚本运行.md)
- [Sample workspace](examples/README.md) · [Shortcuts](examples/notes/shortcuts.md) · [More screenshots](screenshots/)
- Report problems or open a Pull Request via [Issues](https://github.com/hhyufan/mde-tauri/issues).

Licensed under the [MIT License](LICENSE).
