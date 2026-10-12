<div align="center">

# MokiDown · Markdown Editor

**Write docs · Run code · Map knowledge · Self-hosted sync**

An open-source, Notebook-style Markdown workspace built with Tauri 2 + React + Monaco + Milkdown.
Local-first and WYSIWYG: run code blocks right inside your documents, sketch notes as knowledge trees, and sync everything to a server you control.

[▶ Try it live (no download)](https://www.miaogu.xyz/) · [⬇️ Download](https://github.com/hhyufan/mde-tauri/releases) · [中文](README.md)

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Milkdown](https://img.shields.io/badge/Milkdown-7.x-3B82F6) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb) ![License](https://img.shields.io/badge/license-MIT-green)
1
<img src="screenshots/main.png" width="880" alt="MokiDown main window" />


</div>

---

## ✨ Why MokiDown

### ⚡ Runnable Code Blocks

Run Python / JavaScript / TypeScript code blocks directly inside your documents, with output streaming into a built-in console.
Powered by a Rust execution engine: stdin interaction, cancellation, timeouts, and process-tree management on Windows / macOS / Linux.
A **language-service package system** installs runtimes on demand (manifest + install recipe + SHA-256 verification) for Python, JS/TS, Java, Rust, Go, C#, Kotlin, Ruby, and more.

### ✍️ Three Editing Modes, One Editor

- **Source mode**: Monaco Editor (the VS Code engine)
- **WYSIWYG mode**: Milkdown, with tables / images / math / code blocks switchable between rendered and source states
- **Split mode**: draggable divider, editor-to-preview scroll sync, preview zoom following

### 🔌 Built-in LSP Language Services

Connects to local stdio language servers to bring diagnostics, hover info, and completions into the editor, with a unified problems panel.
Language services are managed as data-driven plugin packages that can be installed, removed, and configured — no external editor required.

### ☁️ Self-Hosted Cloud Sync

Built-in accounts (JWT auth) plus an incremental sync engine based on `fileId + rev/baseRev + mutation queue`.
Supports `cloud://` documents, settings sync, and side-by-side conflict resolution (keep local or take remote). The server is open source and deployable anywhere you control (Vercel / Docker / self-hosted).

### 🌳 Tree Editor (mgtree)

Sketch knowledge maps as indentation-based trees with drag-and-drop, folding, and node editing. `>language[index]` jump syntax links tree nodes **directly to code blocks in the document**, with the target block highlighted after jumping.

---

## 🧭 Design Principles

MokiDown's capabilities come from four deliberate trade-offs — the four storylines of the [official site](https://www.miaogu.xyz/#why-mde):

- **Local-first**: files live on your disk by default; your data stays yours, no format lock-in, no forced login
- **Optional sync**: documents and settings join incremental sync only after you sign in; conflicts are shown explicitly — **MokiDown never overwrites your work behind your back**
- **Load-on-demand**: heavy modules (Monaco / Milkdown / Mermaid) load only when needed, keeping the startup path lean
- **WYSIWYG and source, together**: write against rendered text, switch back to Monaco source or split view any time

---

## 📸 Screenshots

| Paper · Light welcome | Night · Dark welcome |
| :---: | :---: |
| ![Light welcome](screenshots/welcome-light.png) | ![Dark welcome](screenshots/welcome-dark.png) |

| Three editing modes (source / WYSIWYG / split) | Runnable code blocks |
| :---: | :---: |
| ![Editing modes](screenshots/editor.png) | ![Code run](screenshots/code-run.png) |

| Cloud sync conflict resolution | Tree editor (mgtree) |
| :---: | :---: |
| ![Sync conflict](screenshots/sync-conflict.png) | ![Tree editor](screenshots/tree.png) |

| Dark editor | Appearance and character settings |
| :---: | :---: |
| ![Dark editor](screenshots/editor-dark.png) | ![Character settings](screenshots/moki-settings.png) |

| Bust portrait and clear starting tasks | Demo: switch modes |
| :---: | :---: |
| ![Moki welcome page](screenshots/welcome-light.png) | ![Mode switch demo](screenshots/mode-switch.gif) |

Captured from the running application with sample documents. Code output and sync conflicts use demonstration data in the real components; these images do not indicate browser access to the desktop execution engine or a connected sync service. [WYSIWYG](screenshots/wysiwyg.png) · [Mobile welcome](screenshots/welcome-mobile.png) · [Design and capture notes](docs/character-design/moki-integration.md)

### Moki, the welcome-page mascot

Moki carries MokiDown's identity through a blue bob, an M↓ hair clip, and a notebook. Bust portraits keep her face readable on the welcome page and compact theme cards. Light mode features a cheerful wave, paper-white clothing, and a sun clasp; dark mode features relaxed night reading with her cheek resting on her hand, navy clothing, and a crescent clasp.

- Shows a static bust portrait with gently drifting Markdown symbols on the welcome page.
- Explains the new document, open file, and open folder actions and offers recent documents.
- Show or hide the welcome mascot and control ambient motion in Settings → Appearance, with reduced motion support.
- The editor keeps its full editing and scrolling space, with no character overlay.

---

## 🚀 Features

### Editing & Preview

- Three modes: source / WYSIWYG / preview / split; automatic fallback for non-Markdown files
- Floating toolbar: bold, italic, strikethrough, headings, quotes, tables, code blocks, links, images, task lists, dividers
- Outline panel synced with headings and lists, click to jump into the editor or preview

### Markdown Capabilities

- GFM: tables, clickable task lists, strikethrough, footnotes
- LaTeX math and Mermaid diagrams
- Language badges, highlighting, and one-click copy for code blocks
- Relative links open in-app, `#Lxx` / `Lxx~xx` line-hint jumps

### Files & Workspace

- Explorer: directory browsing, breadcrumbs, back / forward / up, refresh, sorting, close folder
- Multi-tab workflow: create, switch, rename, unsaved indicators; open / save / save-as / rename / delete
- Unified entry for recent files, bookmarks, and cloud documents
- Drag and drop: into the editor to open, into the explorer to move
- System integration: reveal the current file or folder in the native file manager

### Search & Stats

- `Ctrl+P` global search: filename search + Markdown content search with hit-line jumps
- Stats panel: file count, recent files, word / character count, file-type distribution

### Cloud Sync (Documents + Settings)

By default, local files stay on your disk. After you sign in and bind them, documents and settings join incremental sync.

- Register / login with JWT auth
- Incremental sync engine: `fileId + rev/baseRev + mutation queue`, SHA-256 integrity checks, automatic retries, concurrent pulls
- Binding strategy: local files join sync when bookmarked or bound to a `fileId`; `cloud://<fileId>` cloud-only documents supported
- Conflict resolution: side-by-side comparison, keep local or take remote
- Settings sync and JSON import / export

### Personalization & Experience

- Light / dark themes with transition animations, bilingual UI (i18next)
- Auto-save, unsaved-file protection on close, toast + notification feedback
- Custom title bar, window controls, responsive desktop / mobile layouts

### Cross-Platform

| Platform | Artifacts |
| --- | --- |
| Windows | EXE installer / MSI / portable |
| macOS | Apple Silicon / Intel DMG |
| Linux | deb / rpm / AppImage |
| Android | APK (SAF file access, drawer layout, mobile selection bar) |

### Engineering Quality

- 40+ unit / component tests (Vitest + Testing Library), lint / test / build in CI
- Cold-start tuned: fat LTO + panic=abort + stripped symbols in release, heavy frontend modules lazy-loaded
- Bundle size budget checks, version sync scripts, MSVC build environment detection
- Release pipeline: code signing + auto-updates

---

## ⌨️ Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+P` | File / content search |
| `Ctrl+S` | Save current file |
| `Ctrl+O` | Open file or folder |
| `Ctrl+,` | Open settings |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+Shift+/` | Toggle edit / preview mode |
| `Esc` | Close search / settings / login modal |

---

## 📦 Installation

Download the right build from [Releases](https://github.com/hhyufan/mde-tauri/releases).

- **Windows**: EXE installer recommended; MSI for system integration
- **macOS**: pick Apple Silicon or Intel for your chip
- **Linux**: `.deb` on Ubuntu/Debian, `.rpm` on Fedora, `.AppImage` elsewhere
- **Android**: install the APK (see build notes below)

---

## 🛠 Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 18 + Ant Design 5 + Zustand |
| Editor | Monaco Editor + Milkdown |
| Code execution / LSP | Rust execution engine + language-service packages + local stdio language servers |
| Markdown pipeline | react-markdown + remark-gfm + remark-math + rehype-katex + rehype-sanitize |
| Charts / highlighting | Mermaid + Prism / Shiki |
| i18n | i18next + react-i18next |
| Build | Vite 6 + Tauri CLI 2 |
| Backend | NestJS 10 + Mongoose 8 + MongoDB + JWT (Passport) |

---

## 📂 Project Structure

```text
mde-tauri/
├── src/                      # React frontend source
│   ├── components/           # editor, layout, overlays, UI components
│   ├── hooks/                # file and buffer hooks
│   ├── services/             # API client, sync engine, LSP client
│   ├── store/                # Zustand stores
│   ├── utils/                # helpers and Tauri wrappers
│   └── i18n/                 # locale resources
├── src-tauri/                # Rust side: commands, script runner, LSP, language plugins, bundling
├── docs/                     # implementation notes (sync, language services, script runner, ...)
├── screenshots/              # README image assets (PNG / GIF)
└── README.md
```

The cloud sync server lives in a separate repository: [hhyufan/mde-server](https://github.com/hhyufan/mde-server).
Official visual demo: [miaogu.xyz](https://www.miaogu.xyz/).

---

## 🧑‍💻 Development

### Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 18+ | frontend dependencies |
| Rust | 1.77+ | Tauri build |
| JDK | 17–21 | Android builds |
| WebView2 | bundled on Win10+ | Windows runtime |

### Run the Desktop App

```bash
npm install
npm run tauri:dev      # frontend + Rust
# frontend only (browser debugging)
npm run dev
```

### Build

```bash
npm run tauri:build    # artifacts: src-tauri/target/release/bundle/
```

### Build the Android APK

Install Android Studio (SDK / NDK / Build Tools) and configure `JAVA_HOME` / `ANDROID_HOME`:

```bash
npm run tauri:android:init
npm run tauri:android:build
```

Mobile builds use the narrow-screen layout automatically; file access goes through SAF, and some desktop-only capabilities (arbitrary folder browsing, local script execution) are reduced.

---

## ☁️ Cloud Service (mde-server)

Cloud sync requires the standalone server [hhyufan/mde-server](https://github.com/hhyufan/mde-server) (NestJS + MongoDB):

```bash
git clone https://github.com/hhyufan/mde-server.git
cd mde-server
npm install
cp .env.example .env   # configure MONGODB_URI / JWT_SECRET
npm run start:dev
```

Deployment options:

- **Vercel**: single serverless function setup included (see `VERCEL.md`), use MongoDB Atlas
- **Docker**: Dockerfile provided
- **Self-hosted**: any server running Node + MongoDB

In the client, set the server URL under Settings → Cloud to enable sync.

---

## 🤝 Contributing

Pull requests are welcome:

1. Fork this repository
2. Create a branch: `git checkout -b feature/xxx`
3. Commit: `git commit -m "feat: xxx"` (Conventional Commits recommended)
4. Push and open a Pull Request

---

## 📄 License

Licensed under MIT. See [LICENSE](LICENSE).

---

**MokiDown** — focus on writing, express clearly. Let the tool handle the complexity.
