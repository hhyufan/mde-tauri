#![cfg_attr(all(not(debug_assertions)), windows_subsystem = "windows")]

/// 二进制入口点，只负责少量平台相关的启动准备工作，
/// 随后把控制权交给共享的 Tauri 库启动逻辑。
fn main() {
    // 在 Windows 调试运行时附加父控制台，
    // 这样从终端启动应用时仍能看到 panic 和 println! 输出。
    #[cfg(all(windows, debug_assertions))]
    {
        use windows_sys::Win32::System::Console::AttachConsole;
        unsafe {
            AttachConsole(0xFFFFFFFF);
        }
    }

    mde_lib::run()
}
