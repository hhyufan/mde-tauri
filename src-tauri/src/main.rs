#![cfg_attr(all(not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    // AttachConsole is only useful when running from a terminal during dev so
    // panics / println! show up. In release the windows subsystem is set to
    // "windows" and we want the cleanest, fastest entry path possible — every
    // syscall here happens *before* the WebView starts loading.
    #[cfg(all(windows, debug_assertions))]
    {
        use windows_sys::Win32::System::Console::AttachConsole;
        unsafe {
            AttachConsole(0xFFFFFFFF);
        }
    }

    mde_lib::run()
}
