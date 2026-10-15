/**
 * Rust 后端检查入口。
 *
 * 直接调用 `cargo` 会因为缺少 MSVC 开发环境（`vcvars`）而在链接 proc-macro 构建
 * 脚本时失败（`LNK1104: 无法打开文件 msvcrt.lib`）。这里复用 `scripts/tauri.mjs`
 * 同一套 `initializeMsvc`，保证手工检查与正式构建使用完全相同的编译器环境。
 *
 * 用法：
 *   node scripts/rust.mjs
 *     等价于 cargo check --lib
 *   node scripts/rust.mjs run --example hotkey_probe_check
 *     真机验证全局热键占用探测
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeMsvc } from './windows-msvc.mjs';

try {
  // initializeMsvc 只认 build/dev 子命令，这里借 build 完成环境注入。
  initializeMsvc(['build']);
  if (!process.env.CARGO_TARGET_DIR) {
    process.env.CARGO_TARGET_DIR = fileURLToPath(new URL('../src-tauri/target', import.meta.url));
  }

  const args = process.argv.slice(2);
  const cargoArgs = args.length > 0
    ? args
    : ['check', '--manifest-path', 'src-tauri/Cargo.toml', '--lib'];

  // 测试二进制需要 Common-Controls v6 的 manifest，否则一启动就
  // STATUS_ENTRYPOINT_NOT_FOUND：它静态导入 comctl32 的 TaskDialogIndirect，
  // 而该导出只在 v6（WinSxS）里，System32 的是 v5。tauri-build 只给主程序
  // 嵌 manifest，测试二进制得自己补。详见 src-tauri/comctl32.manifest。
  //
  // 必须配合 --lib：主程序（bin）已由 tauri-build 嵌过 manifest，再注一次会
  // 让 CVTRES 报 CVT1100 资源重复。项目的单元测试都在库模块里，--lib 覆盖得到。
  if (cargoArgs[0] === 'test' && process.platform === 'win32') {
    const manifest = fileURLToPath(new URL('../src-tauri/comctl32.manifest', import.meta.url));
    // /MANIFESTINPUT 必须配 /MANIFEST:EMBED，否则 link.exe 报 LNK1220。
    const flags = [
      '-C', 'link-arg=/MANIFEST:EMBED',
      '-C', `link-arg=/MANIFESTINPUT:${manifest}`,
    ].join(' ');
    process.env.RUSTFLAGS = process.env.RUSTFLAGS ? `${process.env.RUSTFLAGS} ${flags}` : flags;
  }

  const result = spawnSync('cargo', cargoArgs, { stdio: 'inherit', env: process.env, shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`[mokidown] ${error.message}`);
  process.exitCode = 1;
}
