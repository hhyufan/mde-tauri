// 热键探测的纯逻辑：键位解析 + `RegisterHotKey` 探测。
//
// 这里刻意不依赖 Tauri / serde，让命令层（`hotkeys.rs`）和真机验证工具
// （`examples/hotkey_probe_check.rs`）能共用同一份实现，避免“测的和跑的不是
// 同一段代码”。
//
// 注意：本文件被 `include!` 到其他文件中部，因此只能使用普通注释（`//`），
// 且不能出现内部属性（`#![...]`）——两者都要求位于文件最顶部。

#[cfg(target_os = "windows")]
// 命令层与验证工具用到的导入不同，这里统一放行未使用告警。
#[allow(unused_imports)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
};

/// 探测结果。
#[derive(Debug, Clone)]
pub enum HotkeyAvailability {
    /// 当前没有别的程序占用这个组合。
    Available,
    /// 已被占用。
    Taken,
    /// 当前平台无法探测（macOS / Linux 暂无实现）。
    #[cfg(not(target_os = "windows"))]
    Unsupported { platform: String },
    /// 组合本身不合法，无法注册。
    Invalid { reason: String },
}

/// 把前端 `KeyboardEvent.code` 映射为 Windows 虚拟键码。
///
/// 只覆盖注册表里实际会用到的按键；返回 `None` 表示无法注册为全局热键。
#[cfg(target_os = "windows")]
pub fn virtual_key_for_code(code: &str) -> Option<u32> {
    // 字母
    if let Some(letter) = code.strip_prefix("Key") {
        let mut chars = letter.chars();
        let ch = chars.next()?;
        if chars.next().is_some() || !ch.is_ascii_uppercase() {
            return None;
        }
        return Some(ch as u32); // 'A'..'Z' 恰好等于 VK_A..VK_Z
    }
    // 数字
    if let Some(digit) = code.strip_prefix("Digit") {
        let ch = digit.chars().next()?;
        if digit.chars().count() != 1 || !ch.is_ascii_digit() {
            return None;
        }
        return Some(ch as u32); // '0'..'9' 恰好等于 VK_0..VK_9
    }
    // 功能键 F1..F24 -> 0x70..0x87
    if let Some(number) = code.strip_prefix('F') {
        if let Ok(index) = number.parse::<u32>() {
            if (1..=24).contains(&index) {
                return Some(0x70 + index - 1);
            }
        }
        return None;
    }
    // 标点与编辑键
    Some(match code {
        "Slash" => 0xBF,       // VK_OEM_2
        "Backslash" => 0xDC,   // VK_OEM_5
        "Comma" => 0xBC,       // VK_OEM_COMMA
        "Period" => 0xBE,      // VK_OEM_PERIOD
        "Semicolon" => 0xBA,   // VK_OEM_1
        "Quote" => 0xDE,       // VK_OEM_7
        "BracketLeft" => 0xDB, // VK_OEM_4
        "BracketRight" => 0xDD,// VK_OEM_6
        "Minus" => 0xBD,       // VK_OEM_MINUS
        "Equal" => 0xBB,       // VK_OEM_PLUS
        "Backquote" => 0xC0,   // VK_OEM_3
        "Enter" => 0x0D,
        "Escape" => 0x1B,
        "Space" => 0x20,
        "Tab" => 0x09,
        "Backspace" => 0x08,
        "Delete" => 0x2E,
        "Insert" => 0x2D,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "ArrowUp" => 0x26,
        "ArrowDown" => 0x28,
        "ArrowLeft" => 0x25,
        "ArrowRight" => 0x27,
        _ => return None,
    })
}

/// 解析后的热键：Windows 虚拟键码 + 修饰键位掩码。
#[cfg(target_os = "windows")]
pub struct ParsedHotkey {
    pub vk: u32,
    pub modifiers: u32,
}

/// 判断某个主键是否允许没有修饰键。
///
/// 功能键 F1–F24 本身就是合法的全局热键（F1 帮助、F11 全屏都属此类）；
/// 字母、数字、标点单独成键则会抢走正常输入。这条规则必须与前端
/// `utils/keybinding.js` 的 `validateKeybinding` 保持一致。
#[cfg(target_os = "windows")]
fn allows_without_modifier(code: &str) -> bool {
    code.strip_prefix('F')
        .and_then(|rest| rest.parse::<u32>().ok())
        .is_some_and(|index| (1..=24).contains(&index))
}

/// 把归一化键位解析为 Windows 热键描述。
///
/// 约定与前端 `utils/keybinding.js` 保持一致：修饰键顺序为 Ctrl / Alt / Shift / Meta，
/// 主键是 `KeyboardEvent.code`。
#[cfg(target_os = "windows")]
pub fn parse_hotkey(keybinding: &str) -> Result<ParsedHotkey, String> {
    if keybinding.is_empty() {
        return Err("empty".to_string());
    }
    let mut modifiers = 0u32;
    let mut code = None;
    for part in keybinding.split('+') {
        match part {
            // Meta 在 Windows 上落到 Win 键，但语义上更接近“平台主修饰键”；
            // 前端把 macOS 的 ⌘ 归一化成 Ctrl 保存，这里只需处理 Ctrl。
            "Ctrl" | "Meta" => modifiers |= MOD_CONTROL,
            "Alt" => modifiers |= MOD_ALT,
            "Shift" => modifiers |= MOD_SHIFT,
            other => code = Some(other),
        }
    }
    let code = code.ok_or_else(|| "modifierOnly".to_string())?;
    let vk = virtual_key_for_code(code).ok_or_else(|| format!("unsupportedCode:{code}"))?;
    if modifiers == 0 && !allows_without_modifier(code) {
        return Err("needsModifier".to_string());
    }
    Ok(ParsedHotkey { vk, modifiers })
}

/// 尝试注册并立刻注销，返回是否成功以及失败时的错误码。
#[cfg(target_os = "windows")]
pub fn try_register(vk: u32, modifiers: u32) -> Result<(), u32> {
    // 使用一个不会与真实快捷键冲突的固定 id：我们只注册一瞬间。
    const PROBE_ID: i32 = 0x4D4F_4B49; // 'MOKI'
    // windows-sys 把 HWND 表示为 isize，0 即空窗口句柄：热键挂到当前线程，
    // 注册后立刻注销，因此不需要消息循环。
    const NO_WINDOW: isize = 0;
    unsafe {
        // MOD_NOREPEAT 不改变“是否被占用”的判定，但可避免探测期间收到重复消息。
        let ok = RegisterHotKey(NO_WINDOW, PROBE_ID, modifiers | MOD_NOREPEAT, vk);
        if ok == 0 {
            return Err(std::io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32);
        }
        UnregisterHotKey(NO_WINDOW, PROBE_ID);
    }
    Ok(())
}

/// 探测一个热键当前是否可用。
///
/// 局限（必须如实告知，不能把“探测不到”说成“一定可用”）：`RegisterHotKey`
/// 只能发现**同样通过该 API 注册**的热键；用低级键盘钩子、驱动或键盘固件实现的
/// 热键探测不到。
#[cfg(target_os = "windows")]
pub fn probe(keybinding: &str) -> HotkeyAvailability {
    let parsed = match parse_hotkey(keybinding) {
        Ok(value) => value,
        Err(reason) => return HotkeyAvailability::Invalid { reason },
    };
    match try_register(parsed.vk, parsed.modifiers) {
        Ok(()) => HotkeyAvailability::Available,
        // 1409 = ERROR_HOTKEY_ALREADY_REGISTERED：已被别的程序注册。
        Err(1409) => HotkeyAvailability::Taken,
        Err(code) => HotkeyAvailability::Invalid { reason: format!("registerFailed:{code}") },
    }
}
