//! 全局热键占用探测（Tauri 命令层）。
//!
//! 前端的 `keydown` 永远看不到系统级热键：被别的程序用 `RegisterHotKey` 抢走的
//! 组合根本不会送达窗口。因此「这个键位是不是被占用了」只能在原生侧问系统。
//!
//! 解析与探测逻辑放在 `hotkeys_core.rs`（不依赖 Tauri/serde），这样真机验证工具
//! `examples/hotkey_probe_check.rs` 能与线上代码共用同一份实现。
//!
//! 需要如实说明的局限：`RegisterHotKey` 只能发现**同样通过该 API 注册**的热键。
//! 用低级键盘钩子、驱动或键盘固件实现的热键依然探测不到，所以调用方不应把
//! “探测不到”说成“一定可用”。

use serde::Serialize;

include!("hotkeys_core.rs");

/// 供前端消费的探测结果。
///
/// 与 `HotkeyAvailability` 分开定义，是为了让核心文件保持无 serde 依赖。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum HotkeyProbeResult {
    /// 当前没有别的程序占用这个组合。
    Available,
    /// 已被别的程序注册占用。
    Taken,
    /// 当前平台无法探测（macOS / Linux 暂无实现）。
    /// Windows 上不会构造，因此只在非 Windows 平台参与编译。
    #[cfg(not(target_os = "windows"))]
    Unsupported { platform: String },
    /// 组合本身不合法，无法注册。
    Invalid { reason: String },
}

impl From<HotkeyAvailability> for HotkeyProbeResult {
    fn from(value: HotkeyAvailability) -> Self {
        match value {
            HotkeyAvailability::Available => HotkeyProbeResult::Available,
            HotkeyAvailability::Taken => HotkeyProbeResult::Taken,
            #[cfg(not(target_os = "windows"))]
            HotkeyAvailability::Unsupported { platform } => {
                HotkeyProbeResult::Unsupported { platform }
            }
            HotkeyAvailability::Invalid { reason } => HotkeyProbeResult::Invalid { reason },
        }
    }
}

/// 探测一个热键当前是否可用。
///
/// @param keybinding 归一化键位，形如 `Ctrl+Shift+Slash`。
#[tauri::command]
pub fn check_hotkey_available(keybinding: String) -> HotkeyProbeResult {
    #[cfg(target_os = "windows")]
    {
        probe(&keybinding).into()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = keybinding;
        HotkeyProbeResult::Unsupported {
            platform: std::env::consts::OS.to_string(),
        }
    }
}
