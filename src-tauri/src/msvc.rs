//! Discover a complete local MSVC environment for rustc launched from the desktop app.
use crate::script_runner::command;
use once_cell::sync::Lazy;
use std::{collections::HashMap, fs, path::PathBuf, process::Command, sync::Mutex};

static ENVIRONMENT: Lazy<Mutex<Option<HashMap<String, String>>>> = Lazy::new(|| Mutex::new(None));

pub fn configure(compiler: &mut Command) -> Result<(), String> {
    if let Ok(version) = command(compiler.get_program()).arg("-vV").output() {
        if String::from_utf8_lossy(&version.stdout)
            .lines()
            .any(|line| line.starts_with("host:") && line.contains("windows-gnu"))
        {
            return Ok(());
        }
    }
    let mut cached = ENVIRONMENT.lock().unwrap();
    if cached.is_none() {
        *cached = Some(discover()?);
    }
    compiler.envs(cached.as_ref().unwrap());
    Ok(())
}

fn discover() -> Result<HashMap<String, String>, String> {
    let mut installations = vec![];
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        let Some(root) = std::env::var_os(variable).map(PathBuf::from) else {
            continue;
        };
        let vswhere = root.join("Microsoft Visual Studio/Installer/vswhere.exe");
        if vswhere.is_file() {
            if let Ok(output) = command(vswhere)
                .args(["-all", "-products", "*", "-format", "json", "-utf8"])
                .output()
            {
                if let Ok(instances) =
                    serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout)
                {
                    installations.extend(
                        instances.iter().filter_map(|item| {
                            item["installationPath"].as_str().map(PathBuf::from)
                        }),
                    );
                }
            }
        }
        if let Ok(versions) = fs::read_dir(root.join("Microsoft Visual Studio")) {
            for version in versions.flatten() {
                for edition in ["BuildTools", "Community", "Professional", "Enterprise"] {
                    installations.push(version.path().join(edition));
                }
            }
        }
    }
    let architecture = match std::env::consts::ARCH {
        "aarch64" => ("arm64", "amd64_arm64"),
        "x86" => ("x86", "amd64_x86"),
        _ => ("x64", "amd64"),
    };
    for installation in installations {
        let batch = installation.join("VC/Auxiliary/Build/vcvarsall.bat");
        let Ok(entries) = fs::read_dir(installation.join("VC/Tools/MSVC")) else {
            continue;
        };
        let mut versions: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
        versions.sort();
        versions.reverse();
        for tool in versions {
            if !batch.is_file()
                || !tool.join("include/vcruntime.h").is_file()
                || !tool
                    .join(format!("lib/{}/libcmt.lib", architecture.0))
                    .is_file()
                || !tool
                    .join(format!("bin/Hostx64/{}/link.exe", architecture.0))
                    .is_file()
            {
                continue;
            }
            let batch = batch.to_string_lossy();
            let version = tool.file_name().unwrap().to_string_lossy();
            // Only the discovered local toolchain path enters cmd, never source or file names.
            if batch.contains(['"', '%', '!', '^', '&', '|', '<', '>', '\r', '\n'])
                || !version
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'.')
            {
                continue;
            }
            let script = format!(
                "chcp 65001 >nul && call \"{batch}\" {} -vcvars_ver={version} >nul && set",
                architecture.1
            );
            use std::os::windows::process::CommandExt;
            let output = command("cmd.exe")
                .args(["/d", "/s", "/v:off", "/c"])
                .raw_arg(script)
                .output()
                .map_err(|error| error.to_string())?;
            if !output.status.success() {
                continue;
            }
            let environment: HashMap<_, _> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let (name, value) = line.split_once('=')?;
                    (!name.is_empty()).then(|| (name.to_owned(), value.to_owned()))
                })
                .collect();
            if environment.contains_key("LIB") && environment.contains_key("INCLUDE") {
                return Ok(environment);
            }
        }
    }
    Err("Rust 编译需要完整的 MSVC C++ 工具链和 Windows SDK，请在 Visual Studio Installer 中安装“使用 C++ 的桌面开发”。".into())
}
