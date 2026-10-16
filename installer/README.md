# React + Tauri installer

The standalone Windows installer has a frameless, transparent Tauri window,
React controls, direct installation, directory selection, animated feature
panels and a custom progress display. NSIS runs silently in the background;
its wizard, title bar and next/previous buttons are not displayed.

Three feature scenes cover Markdown/preview, themes and document organization.
The chibi scene sheet uses blue/white sneakers in light mode and navy sneakers
in dark mode. The right character stands with both laced sneakers visible.
Motion respects `prefers-reduced-motion`.

## Commands

```powershell
npm run installer:dev         # browser preview; installation is explicitly simulated
npm run installer:tauri:dev   # desktop window; needs a built payload to install
npm run installer:build       # React production build
npm run installer:bundle      # build application, silent payload and standalone EXE
```

`npm run tauri:build` also builds the React installer and the MSI for deployment.
`npm run tauri:build:nsis` builds the app plus React installer without MSI.
The result is `src-tauri/target/release/bundle/react/MokiDown_<version>_x64-setup.exe`.
The payload is embedded into one executable; no adjacent files are needed.
Every package rebuilds the application so its version and updater settings match
the installer. Reusing an older application binary is intentionally rejected.

GitHub Release publishes one branded EXE, its updater signature and latest.json.
First installation and application updates download the exact same file. When
started by the updater (/UPDATE), the installer starts automatically, preserves
the original directory, launches the app and closes without action buttons.
First installation asks only for the location and initial consent, then also
launches the app automatically. No separate manual update package is published.

Release signing order is: finish the EXE, apply Authenticode when configured,
then sign those exact bytes with the Tauri updater key. The update manifest
points directly to that versioned GitHub asset. Local builds do not publish
unsigned update manifests.

## Installation behavior

Rust extracts the payload into an isolated temporary directory, launches it with
`/S` and the selected `/D` directory, then reads complete phase records written
by `src-tauri/windows/progress.nsh`. Progress represents installation **phases**,
not a download rate or a byte counter. React interpolates only the visual width.
Success requires the child process to succeed and the installed executable to
exist in the requested directory. The app then opens automatically.
Closing the installer is blocked while installation runs.

React-driven installs refuse to force-kill a running editor. Updater behavior
without the React progress argument remains unchanged. Backend failures stay in
the React UI and allow retry. Rust validates paths; no shell executes path text.
The custom UI requires WebView2, as other Tauri apps do. The NSIS payload remains an internal build artifact.

The payload template is based on tauri-bundler **2.10.1** (MIT / Apache-2.0).
Keep its upgrade, WebView2, association and uninstall logic in sync when upgrading
the CLI. Customizations only add phase reporting and the running-editor guard
for React-driven installs.

After updating, --moki-after-update bypasses the old splash. Native handover
triggers the page reveal only after the editor window is shown. Reduced-motion
preferences disable decorative motion.
