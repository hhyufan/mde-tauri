//! 子进程创建的统一入口。
//!
//! Windows 上直接 `Command::new(..)` 起控制台程序（powershell、cmd、编译器……），
//! 系统会给它分配一个控制台窗口，用户看到的就是一闪而过的黑框。所以**所有**
//! 起子进程的地方都必须经由这里创建，由这里统一加上 `CREATE_NO_WINDOW`。
//!
//! 唯一的例外是启动 GUI 程序（explorer / open / xdg-open）：它们本来就不带
//! 控制台，不存在这个问题。

use std::ffi::OsStr;
use std::process::Command;

/// 创建一个不会弹出控制台窗口的子进程命令。
///
/// Windows 上等价于 `Command::new(program).creation_flags(CREATE_NO_WINDOW)`；
/// 其他平台就是普通的 `Command::new`。
pub(crate) fn hidden(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：不为子进程分配控制台窗口。
        command.creation_flags(0x0800_0000);
    }
    command
}
