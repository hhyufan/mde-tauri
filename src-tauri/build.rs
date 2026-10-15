fn main() {
    println!("cargo:rerun-if-changed=icons/");
    // capabilities/ 与 tauri.conf.json 会改变生成的 ACL 权限表，但 tauri-build
    // 自己没声明这两个依赖。缺了它们，改了权限也不会重跑 build.rs，运行时依旧
    // 按旧的 ACL 拦截，表现为 "Command plugin:updater|check not allowed by ACL"
    // 这种「明明加了权限却不生效」的怪象。
    println!("cargo:rerun-if-changed=capabilities/");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
