# Silent installation payload

The interactive UI lives in installer/ and uses React + Tauri. This directory
contains the Tauri 2.10.1 NSIS payload template and optional installation phase
reporting. The React installer invokes this payload with /S; no NSIS window is shown.
The payload is internal; the public Release and updater use the same signed React EXE.

See installer/README.md for commands, architecture and runtime requirements.
