//! Local stdio language servers. No TCP listener or shell command interpolation.
use crate::script_runner::{command, ProcessTree};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tempfile::TempDir;

const MAX_MESSAGE: usize = 16 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    session_id: String,
    plugin_id: String,
    language: String,
    file_path: Option<String>,
    file_name: String,
    source: String,
    command: Option<String>,
    args: Option<Vec<String>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    uri: String,
    root_uri: String,
    file_path: String,
    process_id: u32,
    standalone: bool,
    initialization_options: Value,
}
struct Session {
    plugin_id: String,
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    _tree: ProcessTree,
    _temporary: Option<TempDir>,
}
static SESSIONS: Lazy<Mutex<HashMap<String, Arc<Session>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(super) fn find_server(name: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(name.trim().trim_matches('"'));
    if path.is_absolute() {
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("Language server not found: {}", path.display()))
        };
    }
    if path.components().count() != 1 {
        return Err("Use an absolute server path or a command on PATH".into());
    }
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default();
    for variable in ["CARGO_HOME", "DOTNET_ROOT"] {
        if let Some(home) = std::env::var_os(variable) {
            directories.push(PathBuf::from(home).join("bin"));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        directories.push(PathBuf::from(&home).join(".cargo/bin"));
        directories.push(PathBuf::from(home).join(".dotnet/tools"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(appdata).join("npm"));
    }
    for directory in directories {
        let suffixes: &[&str] = if cfg!(windows) {
            &[".exe", ".cmd", ".bat", ""]
        } else {
            &[""]
        };
        for suffix in suffixes {
            let candidate = directory.join(format!("{}{suffix}", path.display()));
            if fs::metadata(&candidate).is_ok_and(|meta| meta.is_file() && meta.len() > 0) {
                return Ok(candidate);
            }
        }
    }
    Err(format!("Executable {name} is not installed or on PATH. Manage services in Settings → Language Services."))
}

fn workspace(file: &Path, language: &str) -> (PathBuf, bool) {
    let parent = file.parent().unwrap_or(file);
    let markers: &[&str] = match language {
        "rust" => &["Cargo.toml", "rust-project.json"],
        "python" => &["pyproject.toml", "pyrightconfig.json", "setup.py"],
        "java" => &[
            "pom.xml",
            "settings.gradle",
            "settings.gradle.kts",
            "build.gradle",
            "build.gradle.kts",
        ],
        "kotlin" => &[
            "pom.xml",
            "settings.gradle",
            "settings.gradle.kts",
            "build.gradle",
            "build.gradle.kts",
            "kls-classpath",
            "kls-classpath.sh",
            "kls-classpath.bat",
            "kls-classpath.cmd",
            "kotlinLspClasspath",
            "kotlinLspClasspath.sh",
            "kotlinLspClasspath.bat",
            "kotlinLspClasspath.cmd",
        ],
        "csharp" => &[],
        _ => &["package.json", "tsconfig.json", "jsconfig.json"],
    };
    for directory in parent.ancestors() {
        let dotnet = language == "csharp"
            && fs::read_dir(directory).is_ok_and(|entries| {
                entries.flatten().any(|entry| {
                    matches!(
                        entry.path().extension().and_then(|ext| ext.to_str()),
                        Some("csproj" | "sln" | "slnx")
                    )
                })
            });
        if dotnet
            || markers
                .iter()
                .any(|marker| directory.join(marker).is_file())
        {
            return (directory.to_path_buf(), false);
        }
    }
    (parent.to_path_buf(), true)
}

fn file_uri(path: &Path) -> Result<String, String> {
    tauri::Url::from_file_path(path)
        .map(|uri| uri.to_string())
        .map_err(|_| "Invalid document path".into())
}

/// The upstream standalone-file resolver searches kotlinc/Maven/Gradle, not its own lib folder.
/// Supply its matching bundled libraries through a private per-process classpath resolver.
pub(super) fn configure_kotlin(
    cmd: &mut Command,
    server: &Path,
    standalone: bool,
    cache: &Path,
) -> Result<Option<TempDir>, String> {
    let java = crate::script_runner::find_lsp_java(17, 21)?;
    if let Some(home) = java.parent().and_then(Path::parent) {
        cmd.env("JAVA_HOME", home);
    }
    if !standalone || kotlin_global_classpath().is_some() {
        return Ok(None);
    }
    configure_kotlin_classpath(cmd, server, cache).map(Some)
}

fn configure_kotlin_classpath(
    cmd: &mut Command,
    server: &Path,
    cache: &Path,
) -> Result<TempDir, String> {
    let lib = server
        .parent()
        .and_then(Path::parent)
        .ok_or("Invalid Kotlin server path")?
        .join("lib");
    let mut jars: Vec<_> = fs::read_dir(&lib)
        .map_err(|error| format!("无法读取 Kotlin 服务标准库：{error}"))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            path.is_file()
                && name.ends_with(".jar")
                && !name.contains("-sources")
                && (name.starts_with("kotlin-stdlib-")
                    || name == "kotlin-stdlib.jar"
                    || name.starts_with("kotlin-script-runtime-")
                    || name.starts_with("annotations-"))
        })
        .collect();
    jars.sort();
    if !jars.iter().any(|path| {
        let name = path.file_name().unwrap().to_string_lossy();
        name == "kotlin-stdlib.jar"
            || name
                .strip_prefix("kotlin-stdlib-")
                .is_some_and(|suffix| suffix.starts_with(|c: char| c.is_ascii_digit()))
    }) {
        return Err("Kotlin 服务安装缺少配套标准库，请重新安装 Kotlin 插件。".into());
    }
    let classpath = jars
        .iter()
        .map(|path| path.to_string_lossy())
        .collect::<Vec<_>>()
        .join(if cfg!(windows) { ";" } else { ":" });
    let directory = tempfile::Builder::new()
        .prefix("kotlin-classpath-")
        .tempdir_in(cache)
        .map_err(|error| error.to_string())?;
    let directory_path = crate::language_plugins::normal_path(
        directory
            .path()
            .canonicalize()
            .map_err(|error| error.to_string())?,
    );
    let resolver = directory_path.join("kotlin-language-server");
    fs::create_dir(&resolver).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    fs::write(resolver.join("classpath.bat"), "@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n<nul set /p \"=%MDE_KOTLIN_CLASSPATH%\"\r\nexit /b 0\r\n").map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let script = resolver.join("classpath.sh");
        fs::write(
            &script,
            "#!/bin/sh\nprintf '%s' \"$MDE_KOTLIN_CLASSPATH\"\n",
        )
        .map_err(|error| error.to_string())?;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    cmd.env("XDG_CONFIG_HOME", directory_path)
        .env("MDE_KOTLIN_CLASSPATH", classpath);
    Ok(directory)
}

fn kotlin_global_classpath() -> Option<PathBuf> {
    let root = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(|home| PathBuf::from(home).join(".config"))
        })?;
    for name in ["kotlin-language-server", "KotlinLanguageServer"] {
        let suffixes: &[&str] = if cfg!(windows) {
            &["bat", "cmd", "ps1"]
        } else {
            &["", "sh", "bash"]
        };
        for suffix in suffixes {
            let path = root.join(name).join(if suffix.is_empty() {
                "classpath".into()
            } else {
                format!("classpath.{suffix}")
            });
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

pub(super) fn server_options(
    plugin: &crate::language_plugins::InstalledPlugin,
    file: &Path,
    standalone: bool,
) -> Result<Value, String> {
    let mut options = plugin.manifest.configuration.clone();
    if !options.is_object() {
        options = json!({});
    }
    if plugin.manifest.id == "mde.typescript" {
        let tsserver = Path::new(&plugin.command)
            .parent()
            .and_then(Path::parent)
            .ok_or("Invalid TypeScript installation")?
            .join("typescript/lib/tsserver.js");
        if !tsserver.is_file() {
            return Err("TypeScript 服务缺少兼容的 tsserver，请卸载后重新安装 JavaScript & TypeScript 插件。".into());
        }
        options["tsserver"] = json!({"path": tsserver});
    }
    if plugin.manifest.id == "mde.rust" {
        let (rustc, _) = crate::script_runner::find_runtime("rust", None)?;
        let output = command(&rustc)
            .args(["--print", "sysroot"])
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let sysroot = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if options.get("checkOnSave").is_none() {
            options["checkOnSave"] = json!(!standalone);
        }
        options["files"] = json!({"watcher":"server"});
        if standalone && options.get("linkedProjects").is_none() {
            let sysroot_src = Path::new(&sysroot).join("lib/rustlib/src/rust/library");
            if !sysroot_src.join("core/src/lib.rs").is_file() {
                return Err("独立 Rust 文件的语言服务需要 rust-src，请运行 rustup component add rust-src 后重启服务。".into());
            }
            options["linkedProjects"] = json!([{"sysroot":sysroot,"sysroot_src":sysroot_src,"crates":[{
                "root_module":file,"edition":"2021","deps":[],"cfg":[],"is_workspace_member":true
            }]}]);
        }
    }
    Ok(options)
}

pub(super) fn write_message(output: &mut impl Write, message: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_MESSAGE {
        return Err("LSP message exceeds 16 MB".into());
    }
    write!(output, "Content-Length: {}\r\n\r\n", bytes.len()).map_err(|error| error.to_string())?;
    output
        .write_all(&bytes)
        .and_then(|_| output.flush())
        .map_err(|error| error.to_string())
}

pub(super) fn read_message(input: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut length = None;
    let mut header_size = 0;
    loop {
        let mut line = String::new();
        let count = (&mut *input)
            .take(8193)
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return if header_size == 0 {
                Ok(None)
            } else {
                Err("Truncated LSP header".into())
            };
        }
        header_size += count;
        if header_size > 8192 {
            return Err("LSP header too large".into());
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                if length.is_some() {
                    return Err("Duplicate Content-Length".into());
                }
                length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|_| "Invalid Content-Length")?,
                );
            }
        }
    }
    let length = length
        .filter(|length| *length <= MAX_MESSAGE)
        .ok_or("Invalid LSP message size")?;
    let mut bytes = vec![0; length];
    input
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn emit(app: &AppHandle, id: &str, kind: &str, message: Value) {
    let _ = app.emit(
        "lsp-message",
        json!({ "sessionId": id, "kind": kind, "message": message }),
    );
}

#[tauri::command]
pub async fn start_lsp(app: AppHandle, request: StartRequest) -> Result<Started, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app, request))
        .await
        .map_err(|error| error.to_string())?
}
fn start(app: &AppHandle, request: StartRequest) -> Result<Started, String> {
    if cfg!(target_os = "android") {
        return Err("Local LSP is available on desktop only".into());
    }
    if request.session_id.is_empty()
        || request.session_id.len() > 80
        || request.source.len() > MAX_MESSAGE
    {
        return Err("Invalid LSP request".into());
    }
    let lifecycle = crate::language_plugins::lifecycle(&request.plugin_id)?;
    let _lifecycle = lifecycle.lock().unwrap();
    let plugin = crate::language_plugins::resolve(app, &request.plugin_id, &request.language)?;
    let server = find_server(
        request
            .command
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&plugin.command),
    )?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("lsp");
    fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    let mut temporary = None;
    let local = request
        .file_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.parent().is_some_and(Path::is_dir));
    let file = if let Some(file) = local {
        file
    } else {
        let directory = tempfile::Builder::new()
            .prefix("document-")
            .tempdir_in(&cache)
            .map_err(|error| error.to_string())?;
        let name = Path::new(&request.file_name)
            .file_name()
            .unwrap_or(std::ffi::OsStr::new("document.txt"));
        let file = directory.path().join(name);
        fs::write(&file, &request.source).map_err(|error| error.to_string())?;
        temporary = Some(directory);
        file
    };
    let (mut root, standalone) = workspace(&file, &request.language);
    let mut file = file;
    if request.language == "csharp" && standalone {
        let directory = tempfile::Builder::new()
            .prefix("csharp-")
            .tempdir_in(&cache)
            .map_err(|error| error.to_string())?;
        root = directory.path().to_path_buf();
        file = root.join("Program.cs");
        fs::write(&file, &request.source).map_err(|error| error.to_string())?;
        let framework = crate::script_runner::lsp_dotnet_framework()?;
        fs::write(root.join("Run.csproj"), format!("<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>{framework}</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>"))
            .map_err(|error| error.to_string())?;
        temporary = Some(directory);
    }
    let initialization_options = server_options(&plugin, &file, standalone)?;
    let mut cmd = command(&server);
    if plugin.manifest.install.kind == "jdtls" {
        cmd.args([
            "-Dfile.encoding=UTF-8",
            "-Dstdout.encoding=UTF-8",
            "-Dstderr.encoding=UTF-8",
        ]);
    }
    cmd.args(request.args.unwrap_or(plugin.args));
    let kotlin_metadata = if plugin.manifest.id == "mde.kotlin" {
        configure_kotlin(&mut cmd, &server, standalone, &cache)?
    } else if request.language == "kotlin" {
        let java = crate::script_runner::find_lsp_java(17, 21)?;
        if let Some(home) = java.parent().and_then(Path::parent) {
            cmd.env("JAVA_HOME", home);
        }
        None
    } else {
        None
    };
    if plugin.manifest.install.kind == "jdtls" {
        // JDT LS requires a distinct metadata directory for each concurrent server.
        let metadata = tempfile::Builder::new()
            .prefix("jdt-")
            .tempdir_in(&cache)
            .map_err(|error| error.to_string())?;
        cmd.arg("-data").arg(metadata.path());
        // Keep metadata alive independently of a virtual source directory.
        // The monitor owns it below.
        return spawn(
            app,
            &request.session_id,
            &request.plugin_id,
            &request.language,
            cmd,
            &file,
            &root,
            standalone,
            temporary,
            Some(metadata),
        )
        .map(|mut started| {
            started.initialization_options = initialization_options;
            started
        });
    }
    spawn(
        app,
        &request.session_id,
        &request.plugin_id,
        &request.language,
        cmd,
        &file,
        &root,
        standalone,
        temporary,
        kotlin_metadata,
    )
    .map(|mut started| {
        started.initialization_options = initialization_options;
        started
    })
}

#[allow(clippy::too_many_arguments)]
fn spawn(
    app: &AppHandle,
    id: &str,
    plugin_id: &str,
    language: &str,
    mut cmd: std::process::Command,
    file: &Path,
    root: &Path,
    standalone: bool,
    temporary: Option<TempDir>,
    metadata: Option<TempDir>,
) -> Result<Started, String> {
    let result_uri = file_uri(file)?;
    let root_uri = file_uri(root)?;
    let mut registry = SESSIONS.lock().unwrap();
    if registry.len() >= 8 || registry.contains_key(id) {
        return Err("Too many LSP sessions or duplicate session ID".into());
    }
    crate::language_plugins::resolve(app, plugin_id, language)?;
    cmd.current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Unable to start language server: {error}"))?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let pid = child.id();
    let output = child.stdout.take().ok_or("Missing LSP stdout")?;
    let errors = child.stderr.take().ok_or("Missing LSP stderr")?;
    let session = Arc::new(Session {
        plugin_id: plugin_id.to_string(),
        input: Mutex::new(child.stdin.take().ok_or("Missing LSP stdin")?),
        child: Mutex::new(child),
        _tree: tree,
        _temporary: temporary,
    });
    registry.insert(id.to_string(), session.clone());
    drop(registry);
    let reader_app = app.clone();
    let reader_id = id.to_string();
    thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            match read_message(&mut reader) {
                Ok(Some(message)) => emit(&reader_app, &reader_id, "message", message),
                Ok(None) => break,
                Err(error) => {
                    emit(&reader_app, &reader_id, "error", json!(error));
                    break;
                }
            }
        }
        stop_lsp(reader_id.clone());
    });
    let errors_app = app.clone();
    let errors_id = id.to_string();
    thread::spawn(move || {
        // Chunked reads bound memory even for a server emitting an unterminated log line.
        let mut errors = errors;
        let mut buffer = [0; 4096];
        while let Ok(count) = errors.read(&mut buffer) {
            if count == 0 {
                break;
            }
            emit(
                &errors_app,
                &errors_id,
                "log",
                json!(String::from_utf8_lossy(&buffer[..count])),
            );
        }
    });
    let monitor_app = app.clone();
    let monitor_id = id.to_string();
    thread::spawn(move || {
        let _metadata = metadata;
        loop {
            let status = session.child.lock().unwrap().try_wait();
            match status {
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                result => {
                    SESSIONS.lock().unwrap().remove(&monitor_id);
                    emit(
                        &monitor_app,
                        &monitor_id,
                        "exit",
                        json!(result.ok().flatten().and_then(|status| status.code())),
                    );
                    break;
                }
            }
        }
    });
    Ok(Started {
        uri: result_uri,
        root_uri,
        file_path: file.to_string_lossy().into_owned(),
        process_id: pid,
        standalone,
        initialization_options: json!({}),
    })
}

#[tauri::command]
pub async fn send_lsp(session_id: String, message: Value) -> Result<(), String> {
    let session = SESSIONS
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or("LSP session has stopped")?;
    tauri::async_runtime::spawn_blocking(move || {
        write_message(&mut *session.input.lock().unwrap(), &message)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn stop_lsp(session_id: String) {
    if let Some(session) = SESSIONS.lock().unwrap().remove(&session_id) {
        // Closing the job/group also terminates the server's children.
        session._tree.terminate();
        let mut child = session.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}
pub fn stop_all() {
    let ids: Vec<_> = SESSIONS.lock().unwrap().keys().cloned().collect();
    for id in ids {
        stop_lsp(id);
    }
}

pub(super) fn stop_plugin(plugin_id: &str) {
    let ids: Vec<_> = SESSIONS
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, session)| session.plugin_id == plugin_id)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        stop_lsp(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn framing_uses_utf8_bytes_and_handles_multiple_messages() {
        let message = json!({"jsonrpc":"2.0", "method":"test", "params":"中文🦀"});
        let mut bytes = vec![];
        write_message(&mut bytes, &message).unwrap();
        write_message(&mut bytes, &json!({"id": 1, "result": null})).unwrap();
        let mut input = Cursor::new(bytes);
        assert_eq!(read_message(&mut input).unwrap(), Some(message));
        assert_eq!(read_message(&mut input).unwrap().unwrap()["id"], 1);
        assert!(read_message(&mut input).unwrap().is_none());
    }
    #[test]
    fn rejects_invalid_or_unbounded_frames() {
        for bytes in [
            b"Content-Length: 999999999\r\n\r\n".as_slice(),
            b"Content-Length: 3\r\n\r\n{}",
            b"Content-Length: -1\r\n\r\n",
            b"X: 1\r\n\r\n",
            b"Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
        ] {
            assert!(read_message(&mut Cursor::new(bytes)).is_err());
        }
    }
    #[test]
    fn discovers_project_root_and_detached_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("src")).unwrap();
        let file = directory.path().join("src/main.rs");
        assert!(workspace(&file, "rust").1);
        fs::write(directory.path().join("Cargo.toml"), "").unwrap();
        assert_eq!(
            workspace(&file, "rust"),
            (directory.path().to_path_buf(), false)
        );
        assert!(file_uri(&file).unwrap().starts_with("file:///"));
    }
    #[test]
    fn kotlin_classpath_contains_matching_stdlib_and_quotes_paths() {
        let directory = tempfile::tempdir().unwrap();
        let root = crate::language_plugins::normal_path(directory.path().canonicalize().unwrap());
        let server_root = root.join("中文 & (Kotlin) %variable%! server");
        fs::create_dir_all(server_root.join("bin")).unwrap();
        fs::create_dir(server_root.join("lib")).unwrap();
        for name in [
            "kotlin-stdlib-2.1.0.jar",
            "kotlin-stdlib-jdk8-2.1.0.jar",
            "kotlin-script-runtime-2.1.0.jar",
            "annotations-13.0.jar",
            "kotlin-compiler-2.1.0.jar",
            "kotlin-stdlib-2.1.0-sources.jar",
        ] {
            fs::write(server_root.join("lib").join(name), "test jar").unwrap();
        }
        let mut cmd = command("java");
        let private = configure_kotlin_classpath(
            &mut cmd,
            &server_root.join("bin/kotlin-language-server.bat"),
            &root,
        )
        .unwrap();
        let environment: HashMap<_, _> = cmd
            .get_envs()
            .filter_map(|(key, value)| {
                value.map(|value| (key.to_os_string(), value.to_os_string()))
            })
            .collect();
        let expected = environment
            .get(std::ffi::OsStr::new("MDE_KOTLIN_CLASSPATH"))
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(expected.contains("kotlin-stdlib-2.1.0.jar"));
        assert!(!expected.contains("kotlin-compiler"));
        assert!(!expected.contains("sources.jar"));
        let resolver = private
            .path()
            .join("kotlin-language-server")
            .join(if cfg!(windows) {
                "classpath.bat"
            } else {
                "classpath.sh"
            });
        let output = command(resolver).envs(environment).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8(output.stdout).unwrap(), expected);
        let private_path = private.path().to_path_buf();
        drop(private);
        assert!(!private_path.exists());
    }
    #[test]
    fn kotlin_custom_classpath_is_a_project_marker() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("nested/main.kt");
        fs::create_dir(directory.path().join("nested")).unwrap();
        fs::write(directory.path().join("kls-classpath.bat"), "@echo off").unwrap();
        assert_eq!(
            workspace(&file, "kotlin"),
            (directory.path().to_path_buf(), false)
        );
    }
}
