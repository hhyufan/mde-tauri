# MDE · Markdown Editor

**Language / 语言**: [中文](README.md) | English

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Vite](https://img.shields.io/badge/Vite-6.2.4-646CFF?logo=vite) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb)

**MDE** is a cross-platform Markdown editor built with Tauri 2 + React + Monaco Editor + Milkdown. It combines local file management, multi-mode Markdown editing, live preview, cloud sync, settings management, and conflict handling in a single desktop-style workspace.

> Lightweight desktop app powered by Rust + system WebView: fast startup, small bundle size.

***

## 🚀 Current Features

### 🖥️ Workspace UI

- **Single-workspace layout**: sidebar, custom title bar, tab bar, main editor area, and status bar.
- **Desktop / mobile responsive layout**: the app adapts to narrow screens, safe areas, and portrait/landscape modes.
- **Custom title bar**: integrates sidebar toggle, search entry, and desktop window controls.

### ✍️ Editing & Preview

- **Monaco source editing** for code-style Markdown editing with syntax highlighting and editor behaviors.
- **Milkdown WYSIWYG editing** with interactive task lists and rendered/source switching for tables, images, math, and code blocks.
- **Three view modes**: edit / preview / split, with fallback behavior for non-Markdown files.
- **Floating toolbar** for bold, italic, strikethrough, headings, quotes, tables, code blocks, links, images, task lists, and horizontal rules.
- **Split-view sync** with adjustable divider, preview zoom sync, and editor-to-preview scroll following.

### 🔍 Markdown Capabilities

- **GFM support**: tables, task lists, strikethrough, footnotes, and related Markdown extensions.
- **Math rendering** with LaTeX support.
- **Mermaid rendering** for `mermaid` code blocks.
- **Code highlighting & copy** in both preview and WYSIWYG-related code blocks.
- **Enhanced internal links**: supports relative Markdown links, in-app file opening, and line-hint jumps such as `#Lxx` / `Lxx~xx`.
- **Outline-linked navigation**: headings and list structures can jump back into the editor or preview panel.

### 📁 Files & Workspace

- **Explorer panel**: directory browsing, breadcrumb navigation, back/forward, go up, refresh, sorting, and close folder.
- **File operations**: open file, open folder, inline create file, save, save as, rename, and delete.
- **Multi-tab workflow**: create, switch, close, scroll through tabs, rename tabs, and show unsaved indicators.
- **Recent files / bookmarks / cloud docs**: one combined entry point for local and cloud-based work.
- **Drag and drop**: drop files into the editor to open them, or into the explorer to move them into the current folder.
- **System file manager integration**: desktop builds can reveal the current file or folder in the native file manager.

### 🔎 Search & Stats

- **Global search**: `Ctrl+P` opens a modal for filename search or Markdown content search.
- **Jump to hits**: content search can open a file and jump to the matched line.
- **Stats panel**: file count, recent file count, words/chars, and file-type distribution.

### ☁️ Cloud Sync (Documents + Settings)

- **Account system** with register/login and JWT auth.
- **Document sync engine** based on `fileId + rev/baseRev + mutation queue`.
- **Binding strategy**: local files join cloud sync when bookmarked or already bound to a cloud `fileId`.
- **Cloud-only documents** via `cloud://<fileId>`, with later local claiming after first save.
- **Conflict resolution** with side-by-side comparison and explicit local/remote choice.
- **Settings sync** for theme, editor config, and layout state, including pull-from-cloud support.
- **Settings import/export** using JSON.

### 🎨 Personalization & App Experience

- **Light/Dark theme switching** with persistence and transition effects.
- **Bilingual UI** (Chinese / English) via i18next.
- **Settings center** for language, workspace, editor options, preview zoom, cloud sync, and JSON import/export.
- **Auto-save and close protection** for saving drafts and confirming unsaved tabs before window close.
- **Toast + notification** feedback system.

***

## ⌨️ Shortcuts

* `Ctrl+P`: Open search modal

* `Ctrl+S`: Save current file

* `Ctrl+O`: Open file/folder

* `Ctrl+,`: Open settings

* `Ctrl+B`: Toggle sidebar

* `Ctrl+Shift+/`: Toggle edit/preview mode

* `Esc`: Close search/settings/login modal

***

## 📦 Installation

Download from [Releases](../../releases).

### Windows

* **EXE installer**: recommended for most users

* **MSI package**: better for system integration scenarios

### macOS

* **Apple Silicon**: `mde_x.x.x_aarch64.dmg`

* **Intel**: `mde_x.x.x_x64.dmg`

### Linux

* **Ubuntu / Debian**: `.deb`

* **Red Hat / Fedora**: `.rpm`

* **Universal**: `.AppImage`

***

## 🛠 Tech Stack

| Layer             | Technology                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| Desktop Shell     | Tauri 2 (Rust)                                                             |
| Frontend          | React 18 + Ant Design 5 + Zustand                                          |
| Editor            | Monaco Editor + Milkdown + Prism / Shiki                                   |
| Markdown Pipeline | react-markdown + Milkdown + remark-gfm + remark-math + rehype-katex + rehype-sanitize |
| Charts            | Mermaid                                                                    |
| i18n              | i18next + react-i18next                                                    |
| Build             | Vite 6 + Tauri CLI 2                                                       |
| Backend           | NestJS 10 + Mongoose 8                                                     |
| Database          | MongoDB                                                                    |
| Auth              | JWT + Passport (Local/JWT)                                                 |

***

## 📂 Project Structure

```text
mde-tauri/
├── src/                      # React frontend source
│   ├── components/           # editor, layout, overlays, UI
│   ├── hooks/                # file and buffer hooks
│   ├── services/             # API client and sync engine
│   ├── store/                # Zustand stores
│   ├── utils/                # helpers and Tauri wrappers
│   ├── i18n/                 # locale resources
│   └── App.jsx               # app root
├── src-tauri/                # Tauri Rust backend
├── mde-server/               # NestJS cloud service
│   ├── src/auth/             # auth module
│   ├── src/sync/             # sync module
│   ├── src/users/            # users module
│   └── src/schemas/          # Mongo schemas
├── public/                   # static assets
├── README.md                 # Chinese README
└── README_EN.md              # English README
```

***

## 🛠 Development

### Requirements

| Tool     | Version           | Notes                         |
| -------- | ----------------- | ----------------------------- |
| Node.js  | 18+               | frontend/backend dependencies |
| Rust     | 1.77+             | Tauri build                   |
| MongoDB  | 6+                | backend storage               |
| JDK      | 17 - 21           | Gradle / Android builds       |
| WebView2 | bundled on Win10+ | runtime for Windows           |

### 1) Run Desktop App

```bash
# in repository root: mde-tauri/
npm install
npm run tauri:dev
```

Frontend only:

```bash
npm run dev
```

### 2) Run Cloud Service

```bash
cd mde-server
npm install
cp .env.example .env
npm run start:dev
```

### 3) Build Desktop Packages

```bash
# back to mde-tauri/
npm run tauri:build
```

Artifacts: `src-tauri/target/release/bundle/`

### 4) Build Android APK

Install Android Studio, SDK, NDK, and Build Tools first. Make sure `JAVA_HOME` and `ANDROID_HOME` / `ANDROID_SDK_ROOT` are configured correctly.

```bash
# generate Android project on first run
npm run tauri:android:init

# run on emulator or connected device
npm run tauri:android:dev

# build APK
npm run tauri:android:build
```

Android uses a narrow-screen layout automatically. File access is adapted through SAF (Storage Access Framework), so some desktop-only features such as arbitrary local folder browsing, opening the native file manager for private app storage, or executing local scripts are reduced or unavailable on mobile.

***

## ⚙️ Configuration

### Client (Settings Panel)

* **General**: language, workspace path, auto-save

* **Appearance**: theme and font size

* **Editor**: tab size, word wrap, line numbers, minimap, font family

* **Cloud**: server URL, sync switch, account, settings sync, JSON import/export

### Server (`.env`)

```env
MONGODB_URI=mongodb://localhost:27017/mde
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
PORT=3000
```

***

## 🤝 Contributing

1. Fork this repository
2. Create branch: `git checkout -b feature/xxx`
3. Commit: `git commit -m "feat: xxx"`
4. Push: `git push origin feature/xxx`
5. Open a Pull Request

Conventional Commits are recommended.

***

## 📄 License

Licensed under MIT. See [LICENSE](LICENSE).
