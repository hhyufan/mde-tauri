//! 热键探测逻辑的真机验证工具。
//!
//! Tauri 的 lib 是 cdylib，`cargo test --lib` 生成的测试二进制在 Windows 上会以
//! `STATUS_ENTRYPOINT_NOT_FOUND` 启动失败，因此探测逻辑改用这个独立 example 验证。
//! 它 `include!` 与线上完全相同的 `hotkeys_core.rs`，所以验证的就是真正跑的代码。
//!
//! ```text
//! node .dbg/check-rust.mjs run --manifest-path src-tauri/Cargo.toml --example hotkey_probe_check
//! ```

include!("../src/hotkeys_core.rs");

#[cfg(target_os = "windows")]
fn main() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_SHIFT,
    };

    // F23 极少被占用，用它避免和真实环境里的热键互相干扰。
    let vk = virtual_key_for_code("F23").expect("F23 应能映射为虚拟键码");
    let modifiers = MOD_CONTROL | MOD_SHIFT;

    // 1) 未被占用时应报告可用
    let before = probe("Ctrl+Shift+F23");
    println!("未注册时探测: {before:?}");

    // 2) 真的占住它，探测必须能发现——这正是前端做不到的事
    const TEST_ID: i32 = 0x4D4F_4B01;
    let registered = unsafe { RegisterHotKey(0, TEST_ID, modifiers, vk) };
    assert_ne!(registered, 0, "无法注册测试热键，环境不允许");
    let during = probe("Ctrl+Shift+F23");
    unsafe { UnregisterHotKey(0, TEST_ID) };
    println!("被占用时探测: {during:?}");

    // 3) 释放后应重新报告可用（同时验证探测没有泄漏注册）
    let after = probe("Ctrl+Shift+F23");
    println!("撤销后探测: {after:?}");

    assert!(matches!(before, HotkeyAvailability::Available), "before={before:?}");
    assert!(matches!(during, HotkeyAvailability::Taken), "during={during:?}");
    assert!(matches!(after, HotkeyAvailability::Available), "after={after:?}");

    // 非法输入不应被当成可用
    for bad in ["Ctrl", "KeyS", "Ctrl+Shift+UnknownKey"] {
        let result = probe(bad);
        println!("非法输入 {bad:?}: {result:?}");
        assert!(matches!(result, HotkeyAvailability::Invalid { .. }), "{bad}");
    }

    // 注册表里真实用到的键位都要能给出结论：功能键不能因为“没有修饰键”而被判非法。
    // 无修饰键的功能键（F1/F11）本来就是合法的全局热键。
    println!("--- 注册表默认键位 ---");
    for keybinding in [
        "F11", "F1", "Ctrl+KeyS", "Ctrl+Shift+KeyF", "Ctrl+Slash", "Ctrl+Shift+KeyZ",
    ] {
        let result = probe(keybinding);
        println!("  {keybinding:<18} {result:?}");
        assert!(
            !matches!(result, HotkeyAvailability::Invalid { .. }),
            "{keybinding} 被判为非法：{result:?}",
        );
    }

    println!("热键探测逻辑验证通过");
}

#[cfg(not(target_os = "windows"))]
fn main() {
    println!("该验证工具只在 Windows 上有意义");
}
