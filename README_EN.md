# MDE · Markdown Editor

**Language / 语言**: [中文](README.md) | English

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react) ![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-0.52.2-007ACC?logo=visualstudiocode) ![Vite](https://img.shields.io/badge/Vite-6.2.4-646CFF?logo=vite) ![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs) ![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb)

**MDE** is a cross-platform Markdown editor built with Tauri 2 + React + Monaco Editor. It focuses on local writing, live preview, cloud sync, conflict resolution, and settings sync.

> Lightweight desktop app powered by Rust + system WebView: fast startup, small bundle size.

---

## 🚀 Current Features

### ✍️ Editing Experience

- **Monaco Editor** with professional code editing behavior and language highlighting.
- **Multi-tab workflow** with create/close/rename and unsaved state indicators.
- **Three view modes**: edit / preview / split (with fallback logic for non-Markdown files).
- **Floating toolbar** for common Markdown operations (bold, heading, table, code block, link, image, task list, etc.).
- **Quick search** (`Ctrl+P`) for both filename search and Markdown content search.

### 🔍 Markdown Preview

- **GFM support**: tables, task lists, strikethrough, footnotes, and more.
- **Math rendering** via `remark-math + rehype-katex`.
- **Mermaid support** for flowcharts, sequence diagrams, and other Mermaid blocks.
- **Code highlighting & copy** with language badges in preview.
- **Safe rendering** with `rehype-sanitize` to reduce XSS risks.
- **Outline-linked navigation** with heading anchors and footnote jumps.

### ☁️ Cloud Sync (Documents + Settings)

- **Account system**: register/login with JWT auth.
- **Document sync engine** based on `fileId + rev/baseRev + mutation queue`.
- **Binding strategy**: local files sync only when bookmarked or already bound to a cloud `fileId`.
- **Conflict dialog** to choose local or remote version.
- **Cloud-only docs** via `cloud://<fileId>` and later local claiming.
- **Settings sync** (theme/editor/layout) with pull-from-cloud support.
- **Settings import/export** through JSON.

### 🧭 Sidebar & Workspace

- **Explorer**: directory browsing, sorting, new file, open folder, save.
- **Outline panel**: parsed heading tree for Markdown.
- **Recent files**: quick access with bookmark-priority ordering.
- **Stats panel**: file count, words/chars, type distribution.

### 🎨 UI / UX

- **Light/Dark themes** with persistence.
- **Bilingual UI** (Chinese/English) via i18next.
- **Custom title bar** with native window controls.
- **Toast + notification** feedback system.

---

## ⌨️ Shortcuts

- `Ctrl+P`: Open search modal
- `Ctrl+S`: Save current file
- `Ctrl+O`: Open file/folder
- `Ctrl+,`: Open settings
- `Ctrl+B`: Toggle sidebar
- `Ctrl+Shift+/`: Toggle edit/preview mode
- `Esc`: Close search/settings/login modal

---

## 📦 Installation

Download from [Releases](../../releases).

### Windows

- **EXE installer**: recommended for most users
- **MSI package**: better for system integration scenarios

### macOS

- **Apple Silicon**: `mde_x.x.x_aarch64.dmg`
- **Intel**: `mde_x.x.x_x64.dmg`

### Linux

- **Ubuntu / Debian**: `.deb`
- **Red Hat / Fedora**: `.rpm`
- **Universal**: `.AppImage`

---

## 📸 Screenshots (Placeholders)

> All image paths below are placeholders by design and can be replaced later.

### Existing Placeholders

| Light Mode | Dark Mode |
| ---------- | --------- |
| ![Light](images/light_en.png) | ![Dark](images/dark_en.png) |

| Edit + Split Preview | Mermaid |
| -------------------- | ------- |
| ![Split](images/split_en.png) | ![Mermaid](images/mermaid_en.png) |

| Sidebar + Outline | Cloud Login |
| ----------------- | ----------- |
| ![Sidebar](images/sidebar_en.png) | ![Login](images/login_en.png) |

### Suggested New Placeholder Shots

| Floating Toolbar | Search (File/Content) |
| ---------------- | --------------------- |
| ![Toolbar](images/toolbar-floating_en.png) | ![Search](images/search-modal-content_en.png) |

| Tab Rename | Recent + Bookmarks |
| ---------- | ------------------ |
| ![Tab Rename](images/tab-rename_en.png) | ![Recent](images/recent-with-bookmarks_en.png) |

| Settings (Appearance/Editor) | Settings (Cloud) |
| ---------------------------- | ---------------- |
| ![Settings Appearance](images/settings-appearance-editor_en.png) | ![Settings Cloud](images/settings-cloud_en.png) |

| Conflict Dialog | Sync Status |
| --------------- | ----------- |
| ![Conflict](images/sync-conflict-dialog_en.png) | ![Sync Status](images/sync-status-indicator_en.png) |

| Stats Panel | Cloud Document (`cloud://`) |
| ----------- | --------------------------- |
| ![Stats](images/stats-panel_en.png) | ![Cloud Doc](images/cloud-doc-tab_en.png) |

| Code Copy Feedback | Footnote Jump |
| ------------------ | ------------- |
| ![Code Copy](images/preview-copy-code_en.png) | ![Footnote Jump](images/preview-footnote-jump_en.png) |

---

## 🛠 Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Desktop Shell | Tauri 2 (Rust) |
| Frontend | React 18 + Ant Design 5 + Zustand |
| Editor | Monaco Editor + Shiki |
| Markdown Pipeline | react-markdown + remark-gfm + remark-math + rehype-katex + rehype-sanitize |
| Charts | Mermaid |
| i18n | i18next + react-i18next |
| Build | Vite 6 + Tauri CLI 2 |
| Backend | NestJS 10 + Mongoose 8 |
| Database | MongoDB |
| Auth | JWT + Passport (Local/JWT) |

---

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

---

## 🛠 Development

### Requirements

| Tool | Version | Notes |
| ---- | ------- | ----- |
| Node.js | 18+ | frontend/backend dependencies |
| Rust | 1.77+ | Tauri build |
| MongoDB | 6+ | backend storage |
| WebView2 | bundled on Win10+ | runtime for Windows |

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

---

## ⚙️ Configuration

### Client (Settings Panel)

- **General**: language, workspace path, auto-save
- **Appearance**: theme and font size
- **Editor**: tab size, word wrap, line numbers, minimap, font family
- **Cloud**: server URL, sync switch, account, settings sync, JSON import/export

### Server (`.env`)

```env
MONGODB_URI=mongodb://localhost:27017/mde
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
PORT=3000
```

---

## 🤝 Contributing

1. Fork this repository
2. Create branch: `git checkout -b feature/xxx`
3. Commit: `git commit -m "feat: xxx"`
4. Push: `git push origin feature/xxx`
5. Open a Pull Request

Conventional Commits are recommended.

---

## 📄 License

Licensed under MIT. See [LICENSE](LICENSE).

