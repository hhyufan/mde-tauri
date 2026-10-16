fn main() {
    let payload = std::env::var_os("MOKI_INSTALLER_PAYLOAD")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("../payload/setup.exe"));
    println!("cargo:rerun-if-env-changed=MOKI_INSTALLER_PAYLOAD");
    println!("cargo:rerun-if-changed={}", payload.display());
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("payload.exe");
    if payload.exists() {
        std::fs::copy(&payload, &output).expect("Could not embed installer payload");
    } else if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("Missing NSIS payload. Build with npm run installer:bundle");
    } else {
        std::fs::write(output, []).unwrap();
    }
    tauri_build::build()
}
