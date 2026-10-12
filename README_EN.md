<div align="center">

# MokiDown · Markdown Editor

**Write docs · Run code · Map knowledge · Self-hosted sync**

An open-source, Notebook-style Markdown workspace built with Tauri 2 + React + Monaco + Milkdown.
Local-first and WYSIWYG: run code blocks right inside your documents, sketch notes as knowledge trees, and sync everything to a server you control.

[▶ Try it live (no download)](https://www.miaogu.xyz/) · [⬇️ Download](https://github.com/hhyufan/mde-tauri/releases) · [中文](README.md)

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Milkdown](https://img.shields.io/badge/Milkdown-7.x-3B82F6) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb) ![License](https://img.shields.io/badge/license-MIT-green)

<img src="screenshots/main.png" width="880" alt="MokiDown main window" />


</div>

---

## ✨ Why MokiDown

### ⚡ Runnable Code Blocks

Run code blocks directly inside your documents, with output streaming into a built-in console; C#, JavaScript, Python, Java, Kotlin and Rust are supported today.
Powered by a Rust execution engine: stdin interaction, cancellation, timeouts, and process-tree management (Windows Job Objects) on Windows / macOS / Linux.

### 🔌 Built-in LSP Language Services (8)

Connects to local stdio language servers to bring diagnostics, hover info, and completions into the editor, with a unified problems panel.
The built-in plugin catalog ships 8 language services: JavaScript & TypeScript, HTML, CSS, Python (Pyright), C# (Roslyn / csharp-ls), Kotlin, Java (Eclipse JDT), and Rust (rust-analyzer).
They are managed as data-driven plugin packages that can be installed, removed, and configured on demand; downloaded packages are verified with SHA-256. You can also add an online plugin catalog or paste a custom JSON manifest — no external editor required.

### ✍️ Three Editing Modes, One Editor

- **Edit mode**: Monaco Editor (the VS Code engine) source editing, and the default for non-Markdown files
- **Preview mode**: Milkdown WYSIWYG for Markdown, with tables / images / math / code blocks switchable between rendered and source states; the tree editor for `.mgtree`
- **Split mode**: draggable divider, editor-to-preview scroll sync, preview zoom following; files without a preview fall back to Monaco

### ☁️ Self-Hosted Cloud Sync

Built-in accounts (JWT auth) plus an incremental sync engine based on `fileId + rev/baseRev + mutation queue`.
Supports `cloud://` documents, settings sync, and side-by-side conflict resolution (keep local or take remote). The server is open source and deployable anywhere you control (Vercel / Docker / self-hosted).

### 🌳 Tree Editor (mgtree)

Sketch knowledge maps as indentation-based trees with drag-and-drop, folding, and node editing. `.mgtree` files get their own multi-color tree icon in the file explorer. The `>language[index]` jump syntax links tree nodes **directly to code blocks in the document**, with the target block highlighted after jumping.

---

## 🧭 Design Principles

MokiDown's capabilities come from four deliberate trade-offs — the four storylines of the [official site](https://www.miaogu.xyz/):

- **Local-first**: files live on your disk by default; your data stays yours, no format lock-in, no forced login
- **Optional sync**: documents and settings join incremental sync only after you sign in; conflicts are shown explicitly — **MokiDown never overwrites your work behind your back**
- **Load-on-demand**: heavy modules (Monaco / Milkdown / Mermaid) load only when needed, keeping the startup path lean
- **WYSIWYG and source, together**: write against rendered text, switch back to Monaco source or split view any time

---

## 📸 Screenshots

| Sunny note · Light welcome | Night read · Dark welcome |
| :---: | :---: |
| Light theme welcome | Dark theme welcome |
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

### Moki, the welcome-page mascot

Moki carries MokiDown's identity through a blue bob, an M↓ hair clip, and a notebook. Bust portraits keep her face readable on the welcome page and compact theme cards. Light mode features a cheerful wave, paper-white clothing, and a sun clasp; dark mode features relaxed night reading with her cheek resting on her hand, navy clothing, and a crescent clasp.

- The welcome page stays minimal: a brand line, one title, a three-card "start with a small task" block (new document / open file / open folder), and recent documents below it.
- Empty states (file tree / outline / recent / search) share one component: a character portrait, one short headline, and a plain one-line hint at the bottom.
- Settings → Appearance is two theme cards (light "Sunny note · Light", dark "Night read · Dark") plus a "Character display" switch; with the character hidden, theme switching becomes compact cards without art, and the welcome page and about page hide her too.
- The about page is a single card: character + brand + version + author + repository link + star hint, with the version shown only once.
- The editor area never shows the character, keeping the full editing and scrolling space; portrait motion respects the system reduced-motion preference.

---

## 🚀 Features

### Editing & Preview

- Three view modes: edit (Monaco source) / preview (Milkdown WYSIWYG for Markdown, tree editor for `.mgtree`) / split (Monaco + read-only preview); files without a preview fall back to Monaco
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

- `Ctrl + P` global search: filename search + Markdown content search with hit-line jumps
- Stats panel: open files, recent files, word / character count, file-type distribution

### Cloud Sync (Documents + Settings)

By default, local files stay on your disk. After you sign in and bind them, documents and settings join incremental sync.

- Register / login with JWT auth
- Incremental sync engine: `fileId + rev/baseRev + mutation queue`, SHA-256 integrity checks, automatic retries, concurrent pulls
- Binding strategy: local files join sync when bookmarked or bound to a `fileId`; `cloud://<fileId>` cloud-only documents supported
- Conflict resolution: side-by-side comparison, keep local or take remote
- Settings sync and JSON import / export

### Personalization & Experience

- Settings groups: General / Appearance / Editor / Language Services / Cloud Sync / About
- Light / dark themes with transition animations, bilingual UI (i18next)
- Auto-save, unsaved-file protection on close, toast + notification feedback
- Custom title bar, window controls, responsive desktop / mobile layouts

### Cross-Platform

| Platform | Artifacts |
| --- | --- |
| Windows | EXE installer (NSIS) / MSI |
| macOS | Apple Silicon / Intel DMG |
| Linux | deb / rpm / AppImage |
| Android | APK (SAF file access, drawer layout, mobile selection bar) |

### Engineering Quality

- 48 unit / component test files (Vitest + Testing Library); CI covers frontend lint / test / format / build / bundle budget plus Rust fmt / clippy / test
- Cold-start tuned: fat LTO + panic=abort + stripped symbols in release, heavy frontend modules lazy-loaded
- Bundle size budget checks, version sync scripts, MSVC build environment detection
- Release pipeline: Windows NSIS + MSI artifacts with code-signing verification

---

## ⌨️ Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + P` | File / content search |
| `Ctrl + S` | Save current file |
| `Ctrl + O` | Open file or folder |
| `Ctrl + J` | Show / hide the output console |
| `Ctrl + Shift + M` | Open the problems panel |
| `F5` | Run current file |
| `Shift + F5` | Stop running |
| `Ctrl + ,` | Open settings |
| `Ctrl + B` | Toggle sidebar |
| `Ctrl + Shift + /` | Toggle edit / preview mode |
| `Esc` | Close search / settings / login modal |

---

## 📦 Installation

Download the right build from [Releases](https://github.com/hhyufan/mde-tauri/releases).

- **Windows**: EXE installer (NSIS) recommended; MSI for system integration
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
| Code execution / LSP | Rust execution engine + language-service plugin packages + local stdio language servers |
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
│   │   ├── editor/           # Monaco / Milkdown / tree editor / console and problems panel
│   │   ├── moki/             # character art, theme cards, welcome page, shared empty state
│   │   └── overlays/         # settings, language services, login, conflict dialogs
│   ├── configs/              # language-service catalog and extension → language map
│   ├── hooks/                # file and buffer hooks
│   ├── services/             # API client, sync engine, LSP client, script runner
│   ├── store/                # Zustand stores
│   ├── showcase/             # browser-only showcase entry (showcase.html) for the live demo
│   ├── utils/                # helpers and Tauri wrappers
│   └── i18n/                 # locale resources
├── src-tauri/                # Rust side: commands, script runner, LSP, language plugins, bundling
├── examples/                 # sample workspace for screenshots and manual checks
├── docs/                     # implementation notes (sync, language services, script runner, ...)
├── screenshots/              # README image assets (PNG / GIF)
└── README.md
```

The cloud sync server lives in a separate repository: [hhyufan/mde-server](https://github.com/hhyufan/mde-server).
Official visual demo: [miaogu.xyz](https://www.miaogu.xyz/).

---

## 🧪 Sample Workspace (examples/)

`examples/` is the sample workspace used for screenshots and manual checks: every connected language service has one minimal source file, plus `notes/` and `web/` subdirectories that exercise expanding and collapsing the file tree.

| Path | Language / capability | Language service |
| --- | --- | --- |
| `hello.ts` · `utils.js` | JavaScript / TypeScript (interface + class + generics; multiple suffixes) | mde.typescript |
| `hello.py` | Python (dataclass + type hints) | mde.pyright |
| `hello.rs` | Rust (struct + impl) | mde.rust |
| `Hello.java` | Java (record + stream) | mde.java |
| `Hello.cs` | C# (record + LINQ) | mde.csharp |
| `Hello.kt` | Kotlin (data class + extension functions) | mde.kotlin |
| `feature-tour.md` | Markdown rendering tour (headings / tables / task lists / quotes) | — |
| `web/index.html` · `web/styles.css` | paired HTML / CSS sample | mde.html · mde.css |
| `notes/code-lab.md` | runnable code blocks | built-in console |
| `notes/knowledge-tree.mgtree` | tree file (indentation is hierarchy) | built-in tree view |
| `notes/shortcuts.md` | shortcut cheat sheet | — |

Language-service plugin IDs keep the remote service's existing identifiers (of the form `mde.*`) and are reproduced as-is.
Maintenance rules: every sample stays directly runnable with no diagnostics; when a language service is added, drop a same-named sample in the top level and update the table above. Full notes live in [examples/README.md](examples/README.md).

---

## 🧑‍💻 Development

### Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 18+ | frontend dependencies (CI uses Node 22) |
| Rust | 1.77+ | Tauri build |
| JDK | 17–21 | Android builds |
| WebView2 | bundled on Win10+ | Windows runtime |

### Common Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | frontend dev server only (browser debugging) |
| `npm run tauri:dev` | frontend + Rust desktop app |
| `npm run build` | frontend build (both `index.html` and `showcase.html` entries) |
| `npm run tauri:build` | package the desktop app (NSIS + MSI by default) |
| `npm run tauri:build:nsis` | NSIS installer only |
| `npm run test` / `npm run test:watch` | Vitest unit and component tests |
| `npm run lint` / `npm run format:check` | ESLint / Prettier checks |
| `npm run check:bundle` | bundle size budget check |
| `npm run version:sync` | sync the version across package.json / Cargo.toml / tauri.conf.json |
| `npm run check` | lint + test + build + bundle budget in one go |

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

## ☁️ Cloud Service (Self-Hosted Server)

Cloud sync requires the standalone server repository [hhyufan/mde-server](https://github.com/hhyufan/mde-server) (NestJS + MongoDB):

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

In the client, set the server URL under Settings → Cloud Sync to enable sync.

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
