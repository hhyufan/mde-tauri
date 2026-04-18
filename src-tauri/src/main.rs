#![cfg_attr(all(not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::AttachConsole;
        unsafe {
            AttachConsole(0xFFFFFFFF);
        }
    }

    mde_lib::run()
}
