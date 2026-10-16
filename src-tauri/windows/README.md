# Silent installation payload

The interactive UI lives in installer/ and uses React + Tauri. This directory
contains the Tauri 2.10.1 NSIS payload template and optional installation phase
reporting. The React installer invokes this payload with /S; no NSIS window is shown.
Normal NSIS/MSI distribution and signed updater artifacts remain available.

See installer/README.md for commands, architecture and runtime requirements.
