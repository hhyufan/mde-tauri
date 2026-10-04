//! Data-driven language-service packages, installed privately under MDE's data directory.
use crate::{
    atomic_write,
    script_runner::{command, ProcessTree},
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub description_zh: String,
    pub languages: Vec<String>,
    #[serde(default)]
    pub extensions: HashMap<String, String>,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub requirements: String,
    #[serde(default)]
    pub requirements_zh: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub configuration: Value,
    pub install: InstallRecipe,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecipe {
    pub kind: String,
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub repository: String,
    #[serde(default)]
    pub asset: String,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub sha256: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub installed_version: String,
    pub command: String,
    pub args: Vec<String>,
}
static JOBS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static LIFECYCLES: Lazy<Mutex<HashMap<String, Weak<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Hold this across resolve + spawn, and across disable/uninstall + stop.
// A server must not appear after stop_plugin has already taken its snapshot.
pub(super) fn lifecycle(id: &str) -> Result<Arc<Mutex<()>>, String> {
    if !valid_id(id) {
        return Err("Invalid plugin ID".into());
    }
    let mut locks = LIFECYCLES.lock().unwrap();
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(id).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(id.into(), Arc::downgrade(&lock));
    Ok(lock)
}
struct Job(String);
fn operation(id: &str) -> Result<Job, String> {
    if !valid_id(id) {
        return Err("Invalid plugin ID".into());
    }
    let mut jobs = JOBS.lock().unwrap();
    if jobs.contains_key(id) {
        return Err("Plugin is busy".into());
    }
    jobs.insert(id.into(), Arc::new(AtomicBool::new(false)));
    Ok(Job(id.into()))
}
impl Drop for Job {
    fn drop(&mut self) {
        JOBS.lock().unwrap().remove(&self.0);
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.')
        && !id.starts_with('.')
        && !id.ends_with('.')
        && !id.contains("..")
        && !["con", "prn", "aux", "nul", "com1", "lpt1"].contains(&id.to_lowercase().as_str())
}
fn relative(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        && !path.contains('\\')
        && !path.contains(':')
}
fn https(url: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(url).map_err(|error| error.to_string())?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err("Use an HTTPS download URL".into());
    }
    Ok(url)
}
pub fn validate(manifest: &PluginManifest) -> Result<(), String> {
    if !valid_id(&manifest.id)
        || manifest.name.trim().is_empty()
        || manifest.languages.is_empty()
        || manifest.languages.len() > 64
        || manifest.args.len() > 128
    {
        return Err("Invalid language-service manifest".into());
    }
    if manifest.languages.iter().any(|id| !valid_id(id))
        || manifest
            .extensions
            .iter()
            .any(|(ext, language)| !valid_id(ext) || !manifest.languages.contains(language))
    {
        return Err("Invalid language or extension contribution".into());
    }
    let recipe = &manifest.install;
    match recipe.kind.as_str() {
        "npm" | "dotnet" => {
            if recipe.packages.is_empty()
                || recipe.packages.len() > 16
                || !relative(&recipe.executable)
                || recipe.executable.contains('/')
                || recipe.packages.iter().any(|package| {
                    package.starts_with('-')
                        || package.is_empty()
                        || !package
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || b"@/._-+^~".contains(&byte))
                })
            {
                return Err("Invalid package installer recipe".into());
            }
        }
        "github" => {
            if recipe.repository.split('/').count() != 2
                || recipe.repository.split('/').any(|part| !valid_id(part))
                || recipe.asset.contains('/')
                || recipe.asset.contains('\\')
                || recipe.asset.is_empty()
            {
                return Err("Invalid GitHub release recipe".into());
            }
            if !relative(&recipe.executable) {
                return Err("Invalid executable path".into());
            }
        }
        "archive" => {
            https(&recipe.url)?;
            if !relative(&recipe.executable) {
                return Err("Invalid executable path".into());
            }
        }
        "jdtls" => {}
        _ => return Err("Supported installers: npm, dotnet, github, archive, jdtls".into()),
    }
    if !recipe.sha256.is_empty()
        && (recipe.sha256.len() != 64
            || !recipe.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err("Invalid SHA-256 checksum".into());
    }
    Ok(())
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("language-plugins");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    root.canonicalize()
        .map(normal_path)
        .map_err(|error| error.to_string())
}

// Node/npm, cmd launchers, .NET tools and the JVM do not consistently accept \\?\ paths.
// Keep canonical identity for checks, but give external programs ordinary absolute paths.
pub(super) fn normal_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(path) = value.strip_prefix("\\\\?\\UNC\\") {
            return PathBuf::from(format!("\\\\{path}"));
        }
        if let Some(path) = value.strip_prefix("\\\\?\\") {
            return PathBuf::from(path);
        }
    }
    path
}
#[derive(Clone)]
struct Reporter(Option<AppHandle>);
fn progress(app: &Reporter, id: &str, phase: &str, percent: Option<u64>, text: &str) {
    let Some(app) = &app.0 else {
        return;
    };
    let _ = app.emit(
        "language-plugin-progress",
        json!({"id":id, "phase":phase, "percent":percent, "text":text}),
    );
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("MDE-Language-Plugins/1.0")
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" || attempt.previous().len() >= 10 {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| error.to_string())
}
fn text(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    https(url)?;
    let response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    let mut result = String::new();
    response
        .take(2 * 1024 * 1024 + 1)
        .read_to_string(&mut result)
        .map_err(|error| error.to_string())?;
    if result.len() > 2 * 1024 * 1024 {
        return Err("Catalog or release metadata exceeds 2 MB".into());
    }
    Ok(result)
}
fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Installation cancelled".into())
    } else {
        Ok(())
    }
}
fn download(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    checksum: &str,
    app: &Reporter,
    id: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    https(url)?;
    let mut response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    let final_url = response.url().to_string();
    let total = response.content_length();
    if total.is_some_and(|size| size > 1024 * 1024 * 1024) {
        return Err("Download exceeds 1 GB".into());
    }
    let mut output = fs::File::create(destination).map_err(|error| error.to_string())?;
    let mut buffer = [0; 65536];
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        cancelled(cancel)?;
        let count = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        received += count as u64;
        if received > 1024 * 1024 * 1024 {
            return Err("Download exceeds 1 GB".into());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        hash.update(&buffer[..count]);
        if last.elapsed() > Duration::from_millis(200) {
            progress(
                app,
                id,
                "downloading",
                total
                    .filter(|size| *size > 0)
                    .map(|size| (received * 100 / size).min(100)),
                &format!("{} MB", received / 1024 / 1024),
            );
            last = Instant::now();
        }
    }
    if !checksum.is_empty()
        && format!("{:x}", hash.finalize()) != checksum.trim_start_matches("sha256:").to_lowercase()
    {
        return Err("Download checksum mismatch".into());
    }
    Ok(final_url)
}
fn unpack(
    archive: &Path,
    format: &str,
    directory: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut expanded = 0u64;
    if format == "zip" {
        let mut archive =
            zip::ZipArchive::new(fs::File::open(archive).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        for index in 0..archive.len() {
            cancelled(cancel)?;
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            let name = entry
                .enclosed_name()
                .ok_or("Archive path escapes plugin directory")?;
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Archive symlinks are not supported".into());
            }
            expanded += entry.size();
            if expanded > 2 * 1024 * 1024 * 1024 {
                return Err("Expanded archive exceeds 2 GB".into());
            }
            let path = directory.join(name);
            if entry.is_dir() {
                fs::create_dir_all(&path).map_err(|error| error.to_string())?;
                continue;
            }
            fs::create_dir_all(path.parent().ok_or("Invalid archive path")?)
                .map_err(|error| error.to_string())?;
            let mut output = fs::File::create(&path).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(mode & 0o777))
                    .map_err(|error| error.to_string())?;
            }
        }
    } else if format == "tar.gz" {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(
            fs::File::open(archive).map_err(|error| error.to_string())?,
        ));
        for entry in archive.entries().map_err(|error| error.to_string())? {
            cancelled(cancel)?;
            let mut entry = entry.map_err(|error| error.to_string())?;
            if !entry.header().entry_type().is_file() && !entry.header().entry_type().is_dir() {
                return Err("Archive links are not supported".into());
            }
            expanded += entry.size();
            if expanded > 2 * 1024 * 1024 * 1024 {
                return Err("Expanded archive exceeds 2 GB".into());
            }
            if !entry
                .unpack_in(directory)
                .map_err(|error| error.to_string())?
            {
                return Err("Archive path escapes plugin directory".into());
            }
        }
    } else if format == "gz" {
        let mut input = flate2::read::GzDecoder::new(
            fs::File::open(archive).map_err(|error| error.to_string())?,
        )
        .take(256 * 1024 * 1024 + 1);
        let mut output =
            fs::File::create(directory.join("rust-analyzer")).map_err(|error| error.to_string())?;
        let size = std::io::copy(&mut input, &mut output).map_err(|error| error.to_string())?;
        if size > 256 * 1024 * 1024 {
            return Err("Binary exceeds 256 MB".into());
        }
    } else {
        return Err("Unsupported archive format".into());
    }
    Ok(())
}
fn executable(directory: &Path, name: &str) -> Option<PathBuf> {
    let suffixes: &[&str] = if cfg!(windows) {
        &[".exe", ".cmd", ".bat", ""]
    } else {
        &[""]
    };
    suffixes
        .iter()
        .map(|suffix| directory.join(format!("{name}{suffix}")))
        .find(|path| path.is_file())
}
fn locate(directory: &Path, name: &str) -> Option<PathBuf> {
    if let Some(path) = executable(directory, name) {
        return Some(path);
    }
    // Release archives often contain one top-level directory; only search that level.
    fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .find_map(|entry| executable(&entry.path(), name))
}
fn run_installer(
    mut cmd: std::process::Command,
    app: &Reporter,
    id: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Cannot start installer: {error}"))?;
    let tree = ProcessTree::attach(&child).map_err(|error| {
        let _ = child.kill();
        let _ = child.wait();
        error
    })?;
    let tail = Arc::new(Mutex::new(String::new()));
    let mut readers = vec![];
    let streams: Vec<Box<dyn Read + Send>> = vec![
        Box::new(child.stdout.take().unwrap()),
        Box::new(child.stderr.take().unwrap()),
    ];
    for mut stream in streams {
        let app = app.clone();
        let id = id.to_string();
        let tail = tail.clone();
        readers.push(thread::spawn(move || {
            let mut buffer = [0; 2048];
            while let Ok(count) = stream.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                let line = String::from_utf8_lossy(&buffer[..count]);
                let mut tail = tail.lock().unwrap();
                tail.push_str(&line);
                if tail.len() > 16384 {
                    let mut offset = tail.len() - 16384;
                    while !tail.is_char_boundary(offset) {
                        offset += 1;
                    }
                    *tail = tail[offset..].to_string();
                }
                progress(&app, &id, "installing", None, line.trim());
            }
        }));
    }
    let started = Instant::now();
    let status = loop {
        if cancel.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(600) {
            tree.terminate();
            let _ = child.kill();
            let _ = child.wait();
            break Err(if cancel.load(Ordering::SeqCst) {
                "Installation cancelled".to_string()
            } else {
                "Installer timed out".to_string()
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                tree.terminate();
                let _ = child.kill();
                let _ = child.wait();
                break Err(error.to_string());
            }
        }
    };
    tree.terminate();
    for reader in readers {
        let _ = reader.join();
    }
    if !status?.success() {
        return Err(format!("Installer failed: {}", tail.lock().unwrap().trim()));
    }
    Ok(())
}
fn native_target() -> Result<String, String> {
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "x86" => "i686",
        _ => return Err("Unsupported CPU architecture".into()),
    };
    let system = match std::env::consts::OS {
        "windows" => "pc-windows-msvc",
        "linux" => "unknown-linux-gnu",
        "macos" => "apple-darwin",
        _ => return Err("Local language services are available on desktop only".into()),
    };
    Ok(format!("{architecture}-{system}"))
}
fn install_payload(
    manifest: &PluginManifest,
    directory: &Path,
    app: &Reporter,
    cancel: &AtomicBool,
) -> Result<(String, Vec<String>, String), String> {
    let recipe = &manifest.install;
    let mut version = manifest.version.clone();
    let command_path;
    let mut args = manifest.args.clone();
    match recipe.kind.as_str() {
        "npm" => {
            let npm = crate::lsp::find_server("npm")?;
            let mut cmd = command(npm);
            cmd.arg("install")
                .arg("--prefix")
                .arg(directory)
                .args([
                    "--no-audit",
                    "--no-fund",
                    "--ignore-scripts",
                    "--package-lock=true",
                ])
                .args(&recipe.packages)
                .current_dir(directory);
            run_installer(cmd, app, &manifest.id, cancel)?;
            command_path = executable(&directory.join("node_modules/.bin"), &recipe.executable)
                .ok_or("Package does not contain the declared executable")?;
            if let Some(package) = recipe.packages.first() {
                let name = if package.starts_with('@') {
                    package
                        .rsplit_once('@')
                        .filter(|(name, _)| !name.is_empty())
                        .map(|(name, _)| name)
                        .unwrap_or(package)
                } else {
                    package.split('@').next().unwrap_or(package)
                };
                if let Ok(data) = fs::read_to_string(
                    directory
                        .join("node_modules")
                        .join(name)
                        .join("package.json"),
                ) {
                    version = serde_json::from_str::<Value>(&data)
                        .ok()
                        .and_then(|value| value["version"].as_str().map(str::to_string))
                        .unwrap_or(version);
                }
            }
        }
        "dotnet" => {
            let (dotnet, _) = crate::script_runner::find_runtime("csharp", None)?;
            let mut cmd = command(dotnet);
            cmd.args(["tool", "install", &recipe.packages[0], "--tool-path"])
                .arg(directory)
                .current_dir(directory);
            if manifest.version != "latest" {
                cmd.arg("--version").arg(&manifest.version);
            }
            run_installer(cmd, app, &manifest.id, cancel)?;
            command_path =
                executable(directory, &recipe.executable).ok_or("Tool executable is missing")?;
        }
        "github" | "archive" | "jdtls" => {
            let client = client()?;
            let (url, format, checksum) = if recipe.kind == "github" {
                let format = if recipe.format == "native" {
                    if cfg!(windows) {
                        "zip"
                    } else {
                        "gz"
                    }
                } else {
                    recipe.format.as_str()
                };
                let asset_name = recipe
                    .asset
                    .replace("{target}", &native_target()?)
                    .replace("{archive}", format);
                // Public release downloads have no unauthenticated API-rate-limit dependency.
                let release_path = if manifest.version == "latest" {
                    "latest/download".into()
                } else {
                    format!("download/{}", manifest.version)
                };
                (
                    format!(
                        "https://github.com/{}/releases/{release_path}/{asset_name}",
                        recipe.repository
                    ),
                    format.to_string(),
                    recipe.sha256.clone(),
                )
            } else if recipe.kind == "jdtls" {
                let name = text(
                    &client,
                    "https://download.eclipse.org/jdtls/snapshots/latest.txt",
                )?
                .trim()
                .to_string();
                if !relative(&name) || name.contains('/') || !name.ends_with(".tar.gz") {
                    return Err("Invalid JDT LS release name".into());
                }
                version = name
                    .trim_start_matches("jdt-language-server-")
                    .trim_end_matches(".tar.gz")
                    .into();
                (
                    format!("https://download.eclipse.org/jdtls/snapshots/{name}"),
                    "tar.gz".into(),
                    String::new(),
                )
            } else {
                (
                    recipe.url.clone(),
                    recipe.format.clone(),
                    recipe.sha256.clone(),
                )
            };
            let archive = directory.join(".download");
            let final_url = download(
                &client,
                &url,
                &archive,
                &checksum,
                app,
                &manifest.id,
                cancel,
            )?;
            if recipe.kind == "github" {
                if let Some(rest) = final_url.split("/releases/download/").nth(1) {
                    version = rest.split('/').next().unwrap_or(&version).to_string();
                }
            }
            progress(app, &manifest.id, "extracting", None, "");
            unpack(&archive, &format, directory, cancel)?;
            fs::remove_file(&archive).map_err(|error| error.to_string())?;
            if recipe.kind == "jdtls" {
                let (java, _) = crate::script_runner::find_runtime("java", None)?;
                let launcher = fs::read_dir(directory.join("plugins"))
                    .map_err(|error| error.to_string())?
                    .flatten()
                    .find(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with("org.eclipse.equinox.launcher_")
                            && entry
                                .path()
                                .extension()
                                .is_some_and(|extension| extension == "jar")
                    })
                    .ok_or("JDT LS launcher is missing")?
                    .path();
                let configuration = if cfg!(windows) {
                    "config_win"
                } else if cfg!(target_os = "macos") {
                    "config_mac"
                } else {
                    "config_linux"
                };
                args = vec![
                    "-Declipse.application=org.eclipse.jdt.ls.core.id1".into(),
                    "-Dosgi.bundles.defaultStartLevel=4".into(),
                    "-Declipse.product=org.eclipse.jdt.ls.core.product".into(),
                    "-Xmx1G".into(),
                    "--add-modules=ALL-SYSTEM".into(),
                    "--add-opens".into(),
                    "java.base/java.util=ALL-UNNAMED".into(),
                    "--add-opens".into(),
                    "java.base/java.lang=ALL-UNNAMED".into(),
                    "-jar".into(),
                    launcher.to_string_lossy().into_owned(),
                    "-configuration".into(),
                    directory.join(configuration).to_string_lossy().into_owned(),
                ];
                args.extend(manifest.args.clone());
                command_path = java;
            } else {
                command_path = locate(directory, &recipe.executable)
                    .ok_or("Archive does not contain the declared executable")?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mut permissions = fs::metadata(&command_path)
                        .map_err(|error| error.to_string())?
                        .permissions();
                    permissions.set_mode(permissions.mode() | 0o700);
                    fs::set_permissions(&command_path, permissions)
                        .map_err(|error| error.to_string())?;
                }
            }
        }
        _ => return Err("Unsupported installer".into()),
    }
    Ok((command_path.to_string_lossy().into_owned(), args, version))
}
fn read_installed(directory: &Path) -> Result<InstalledPlugin, String> {
    serde_json::from_slice(
        &fs::read(directory.join("plugin.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}
pub fn resolve(app: &AppHandle, id: &str, language: &str) -> Result<InstalledPlugin, String> {
    if !valid_id(id) {
        return Err("Invalid plugin ID".into());
    }
    if JOBS.lock().unwrap().contains_key(id) {
        return Err("Plugin is busy".into());
    }
    let plugin = read_installed(&root(app)?.join(id))?;
    if !plugin.enabled || !plugin.manifest.languages.iter().any(|id| id == language) {
        return Err("Language plugin is disabled or does not support this document".into());
    }
    Ok(plugin)
}
#[tauri::command]
pub async fn list_language_plugins(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = vec![];
        for entry in fs::read_dir(root(&app)?)
            .map_err(|error| error.to_string())?
            .flatten()
        {
            if entry.path().is_dir() && valid_id(&entry.file_name().to_string_lossy()) {
                if let Ok(plugin) = read_installed(&entry.path()) {
                    result.push(plugin);
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn fetch_language_catalog(url: String) -> Result<Vec<PluginManifest>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manifests: Vec<PluginManifest> =
            serde_json::from_str(&text(&client()?, &url)?).map_err(|error| error.to_string())?;
        if manifests.len() > 500 {
            return Err("Catalog exceeds 500 plugins".into());
        }
        let mut ids = HashSet::new();
        for manifest in &manifests {
            validate(manifest)?;
            if !ids.insert(&manifest.id) {
                return Err("Duplicate plugin ID".into());
            }
        }
        Ok(manifests)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn install_language_plugin(
    app: AppHandle,
    manifest: PluginManifest,
) -> Result<InstalledPlugin, String> {
    validate(&manifest)?;
    if cfg!(target_os = "android") {
        return Err("Language plugins require the desktop app".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = JOBS.lock().unwrap();
        if jobs.contains_key(&manifest.id) {
            return Err("Plugin is busy".into());
        }
        jobs.insert(manifest.id.clone(), cancel.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _job = Job(manifest.id.clone());
        let result = (|| {
            let root = root(&app)?;
            let destination = root.join(&manifest.id);
            if destination.exists() {
                return read_installed(&destination);
            }
            let temporary = tempfile::Builder::new()
                .prefix(".install-")
                .tempdir_in(&root)
                .map_err(|error| error.to_string())?;
            progress(
                &Reporter(Some(app.clone())),
                &manifest.id,
                "preparing",
                None,
                "",
            );
            let (command, args, version) = install_payload(
                &manifest,
                temporary.path(),
                &Reporter(Some(app.clone())),
                &cancel,
            )?;
            cancelled(&cancel)?;
            // Rewrite staging paths before committing the entire package atomically.
            let staging = temporary.path().to_string_lossy();
            let target = destination.to_string_lossy();
            let plugin = InstalledPlugin {
                manifest: manifest.clone(),
                enabled: true,
                installed_version: version,
                command: command.replace(staging.as_ref(), target.as_ref()),
                args: args
                    .into_iter()
                    .map(|argument| argument.replace(staging.as_ref(), target.as_ref()))
                    .collect(),
            };
            fs::write(
                temporary.path().join("plugin.json"),
                serde_json::to_vec_pretty(&plugin).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            fs::rename(temporary.path(), &destination).map_err(|error| error.to_string())?;
            Ok(plugin)
        })();
        match &result {
            Ok(_) => progress(
                &Reporter(Some(app.clone())),
                &manifest.id,
                "complete",
                Some(100),
                "",
            ),
            Err(error) => progress(
                &Reporter(Some(app.clone())),
                &manifest.id,
                "error",
                None,
                error,
            ),
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn cancel_language_plugin_install(id: String) {
    if let Some(cancel) = JOBS.lock().unwrap().get(&id) {
        cancel.store(true, Ordering::SeqCst);
    }
}
pub(super) fn cancel_all() {
    for cancel in JOBS.lock().unwrap().values() {
        cancel.store(true, Ordering::SeqCst);
    }
}
#[tauri::command]
pub async fn set_language_plugin_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation(&id)?;
        let lifecycle = lifecycle(&id)?;
        let _lifecycle = lifecycle.lock().unwrap();
        let path = root(&app)?.join(&id);
        let mut plugin = read_installed(&path)?;
        plugin.enabled = enabled;
        atomic_write(
            &path.join("plugin.json"),
            &serde_json::to_vec_pretty(&plugin).map_err(|error| error.to_string())?,
        )?;
        crate::lsp::stop_plugin(&id);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
fn remove_package(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Invalid plugin ID".into());
    }
    let path = root.join(id);
    if !path.exists() {
        return Ok(());
    }
    let resolved = path
        .canonicalize()
        .map(normal_path)
        .map_err(|error| error.to_string())?;
    let root_identity = root
        .canonicalize()
        .map(normal_path)
        .map_err(|error| error.to_string())?;
    if !resolved.starts_with(&root_identity)
        || resolved == root_identity
        || fs::symlink_metadata(&path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Plugin path is outside the managed directory".into());
    }
    fs::remove_dir_all(path).map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn uninstall_language_plugin(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation(&id)?;
        let lifecycle = lifecycle(&id)?;
        let _lifecycle = lifecycle.lock().unwrap();
        crate::lsp::stop_plugin(&id);
        remove_package(&root(&app)?, &id)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn external_program_paths_have_no_verbatim_prefix() {
        assert_eq!(
            normal_path(PathBuf::from(r"\\?\C:\Users\test\plugins")),
            PathBuf::from(r"C:\Users\test\plugins")
        );
        assert_eq!(
            normal_path(PathBuf::from(r"\\?\UNC\server\share\plugins")),
            PathBuf::from(r"\\server\share\plugins")
        );
    }

    #[test]
    #[ignore = "downloads and executes upstream language servers; requires their runtimes"]
    fn online_install_launch_and_uninstall() {
        let catalog: Vec<PluginManifest> =
            serde_json::from_str(include_str!("../../src/configs/language-plugins.json")).unwrap();
        let selected = std::env::var("MDE_PLUGIN_SMOKE").unwrap_or(
            "mde.typescript,mde.html,mde.css,mde.pyright,mde.csharp,mde.kotlin,mde.java,mde.rust"
                .into(),
        );
        let temporary = tempfile::tempdir().unwrap();
        let root = normal_path(temporary.path().canonicalize().unwrap());
        for manifest in catalog
            .iter()
            .filter(|plugin| selected.split(',').any(|id| id == plugin.id))
        {
            let stage = root.join("stage");
            fs::create_dir(&stage).unwrap();
            eprintln!("Installing {}", manifest.id);
            let (program, args, version) =
                install_payload(manifest, &stage, &Reporter(None), &AtomicBool::new(false))
                    .unwrap();
            let destination = root.join(&manifest.id);
            eprintln!("{} installed: {} {:?}", manifest.id, program, args);
            fs::rename(&stage, &destination).unwrap();
            let old = stage.to_string_lossy();
            let new = destination.to_string_lossy();
            let program = program.replace(old.as_ref(), new.as_ref());
            let plugin = InstalledPlugin {
                manifest: manifest.clone(),
                enabled: true,
                installed_version: version.clone(),
                command: program.clone(),
                args: args.clone(),
            };
            let extension = if manifest.id == "mde.kotlin" {
                "kt"
            } else {
                manifest.extensions.keys().next().unwrap().as_str()
            };
            let file = root.join(format!("main.{extension}"));
            if manifest.id == "mde.rust" {
                fs::write(&file, "fn apple_function() {}\nfn main() { appl\n").unwrap();
            }
            if manifest.id == "mde.kotlin" {
                fs::write(&file, "fun appleFunction() = 42\nfun main() { appl }\n").unwrap();
            }
            let options = crate::lsp::server_options(&plugin, &file, true).unwrap();
            let mut cmd = command(program);
            cmd.args(
                args.iter()
                    .map(|arg| arg.replace(old.as_ref(), new.as_ref())),
            )
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
            if manifest.install.kind == "jdtls" {
                cmd.arg("-data").arg(root.join("jdt-data"));
            }
            // Use the same environment and classpath wiring as desktop startup.
            let _kotlin_classpath = if manifest.id == "mde.kotlin" {
                crate::lsp::configure_kotlin(&mut cmd, Path::new(&plugin.command), true, &root)
                    .unwrap()
            } else {
                None
            };
            let mut child = cmd.spawn().unwrap();
            let tree = ProcessTree::attach(&child).unwrap();
            let mut errors = child.stderr.take().unwrap();
            let error_reader = thread::spawn(move || {
                let mut output = Vec::new();
                errors.read_to_end(&mut output).unwrap();
                String::from_utf8_lossy(&output).into_owned()
            });
            let (send, receive) = std::sync::mpsc::channel();
            let stdout = child.stdout.take().unwrap();
            let reader = thread::spawn(move || {
                let mut input = std::io::BufReader::new(stdout);
                loop {
                    match crate::lsp::read_message(&mut input) {
                        Ok(Some(message)) => {
                            if send.send(message).is_err() {
                                break;
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            eprintln!("LSP framing error: {error}");
                            break;
                        }
                    }
                }
            });
            let mut input = child.stdin.take().unwrap();
            let root_uri = tauri::Url::from_directory_path(&root).unwrap().to_string();
            crate::lsp::write_message(&mut input, &json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{
                "processId":null, "rootUri":root_uri, "workspaceFolders":[{"uri":root_uri,"name":"test"}],
                "capabilities":{"general":{"positionEncodings":["utf-16"]},"workspace":{"configuration":true},"textDocument":{"diagnostic":{}}}, "initializationOptions":options
            }})).unwrap();
            let initialized = loop {
                match receive.recv_timeout(Duration::from_secs(90)) {
                    Ok(message) if message["id"] == 1 && message.get("method").is_none() => {
                        eprintln!(
                            "{} initialized: {}",
                            manifest.id,
                            message.get("error").unwrap_or(&json!("ok"))
                        );
                        break message.get("result").is_some();
                    }
                    Ok(message)
                        if message.get("method").is_some() && message.get("id").is_some() =>
                    {
                        crate::lsp::write_message(
                            &mut input,
                            &json!({"jsonrpc":"2.0", "id":message["id"], "result":null}),
                        )
                        .unwrap();
                    }
                    Ok(_) => {}
                    Err(_) => break false,
                }
            };
            let mut functional = true;
            if initialized && (manifest.id == "mde.kotlin" || manifest.id == "mde.rust") {
                let (language, source) = if manifest.id == "mde.rust" {
                    ("rust", "fn apple_function() {}\nfn main() { appl\n")
                } else {
                    ("kotlin", "fun appleFunction() = 42\nfun main() { appl }\n")
                };
                fs::write(&file, source).unwrap();
                let uri = tauri::Url::from_file_path(&file).unwrap().to_string();
                crate::lsp::write_message(
                    &mut input,
                    &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
                )
                .unwrap();
                crate::lsp::write_message(&mut input, &json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"languageId":language,"version":1,"text":source}}})).unwrap();
                let started = Instant::now();
                let mut request_id = 2;
                let mut completion = false;
                let mut diagnostics = false;
                while started.elapsed() < Duration::from_secs(60) && (!completion || !diagnostics) {
                    let method = if completion && language == "rust" {
                        "textDocument/diagnostic"
                    } else {
                        "textDocument/completion"
                    };
                    let character = if language == "rust" { 16 } else { 17 };
                    crate::lsp::write_message(&mut input, &json!({"jsonrpc":"2.0","id":request_id,"method":method,"params":{"textDocument":{"uri":uri},"position":{"line":1,"character":character}}})).unwrap();
                    loop {
                        if started.elapsed() >= Duration::from_secs(60) {
                            break;
                        }
                        let Ok(message) = receive.recv_timeout(Duration::from_secs(10)) else {
                            break;
                        };
                        if message["method"] == "textDocument/publishDiagnostics"
                            && message["params"]["uri"] == uri
                        {
                            diagnostics |= message["params"]["diagnostics"]
                                .as_array()
                                .is_some_and(|items| !items.is_empty());
                        }
                        if message.get("method").is_some() && message.get("id").is_some() {
                            let result = if message["method"] == "workspace/configuration" {
                                json!(message["params"]["items"]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .map(|_| options.clone())
                                    .collect::<Vec<_>>())
                            } else {
                                Value::Null
                            };
                            crate::lsp::write_message(
                                &mut input,
                                &json!({"jsonrpc":"2.0","id":message["id"],"result":result}),
                            )
                            .unwrap();
                        } else if message["id"] == request_id && message.get("method").is_none() {
                            let result = &message["result"];
                            if method == "textDocument/diagnostic" && request_id < 8 {
                                eprintln!("Diagnostic response: {message}");
                            }
                            if method == "textDocument/completion" {
                                completion |= result
                                    .as_array()
                                    .or_else(|| result["items"].as_array())
                                    .is_some_and(|items| {
                                        items.iter().any(|item| {
                                            item["label"]
                                                .as_str()
                                                .is_some_and(|label| label.contains("apple"))
                                        })
                                    });
                            } else {
                                diagnostics |= result["items"]
                                    .as_array()
                                    .is_some_and(|items| !items.is_empty());
                            }
                            break;
                        }
                    }
                    request_id += 1;
                    thread::sleep(Duration::from_millis(500));
                }
                functional = completion && diagnostics;
                eprintln!(
                    "{} actual completion: {completion}, diagnostics: {diagnostics}",
                    manifest.id
                );
                if functional && language == "kotlin" {
                    let valid = "import kotlin.random.Random\nopen class Animal { open fun eat() { println(\"I can eat\") } }\nclass Bird : Animal() { fun fly(): Unit { println(Random.nextInt(1, 100)) } }\nfun main() { val bird = Bird(); bird.fly(); bird.eat(); println(listOf(1, 2).joinToString()) }\n";
                    crate::lsp::write_message(&mut input, &json!({"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":valid}]}})).unwrap();
                    let deadline = Instant::now();
                    let mut clean = false;
                    while deadline.elapsed() < Duration::from_secs(30) {
                        let Ok(message) = receive.recv_timeout(Duration::from_secs(5)) else {
                            continue;
                        };
                        if message["method"] == "textDocument/publishDiagnostics"
                            && message["params"]["uri"] == uri
                        {
                            eprintln!("Kotlin stdlib diagnostics: {}", message["params"]);
                            if message["params"]["version"] == 2
                                || message["params"]["version"].is_null()
                            {
                                clean = message["params"]["diagnostics"].as_array().is_some_and(
                                    |items| items.iter().all(|item| item["severity"] != 1),
                                );
                                break;
                            }
                        }
                    }
                    functional &= clean;
                    eprintln!(
                        "Kotlin Unit/println/Random/inheritance standard-library fixture: {clean}"
                    );
                }
            }
            tree.terminate();
            let _ = child.kill();
            let _ = child.wait();
            drop(input);
            let _ = reader.join();
            let stderr = error_reader.join().unwrap();
            assert!(
                initialized && functional,
                "{} failed to initialize: {}",
                manifest.id,
                stderr
            );
            remove_package(&root, &manifest.id).unwrap();
            assert!(!destination.exists());
            eprintln!(
                "{} {version}: installed, initialized and uninstalled",
                manifest.id
            );
        }
    }
    #[test]
    fn catalog_is_valid_and_contributes_all_requested_languages() {
        let catalog: Vec<PluginManifest> =
            serde_json::from_str(include_str!("../../src/configs/language-plugins.json")).unwrap();
        let languages: HashSet<_> = catalog
            .iter()
            .flat_map(|plugin| {
                validate(plugin).unwrap();
                plugin.languages.clone()
            })
            .collect();
        for language in [
            "javascript",
            "html",
            "css",
            "python",
            "csharp",
            "kotlin",
            "java",
            "rust",
        ] {
            assert!(languages.contains(language));
        }
    }
    #[test]
    fn uninstall_is_confined_to_one_managed_package() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        fs::create_dir(root.join("example.go")).unwrap();
        fs::create_dir(root.join("example.rust")).unwrap();
        fs::write(root.join("example.go/server"), "binary").unwrap();
        assert!(remove_package(&root, "../").is_err());
        remove_package(&root, "example.go").unwrap();
        assert!(!root.join("example.go").exists());
        assert!(root.join("example.rust").exists());
    }
    #[test]
    fn uninstall_waits_for_inflight_start_before_stopping_and_removing() {
        use std::sync::{atomic::AtomicUsize, mpsc};
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        fs::create_dir(root.join("race.rust")).unwrap();
        let session_count = Arc::new(AtomicUsize::new(0));
        let start = lifecycle("race.rust").unwrap();
        let starting = start.lock().unwrap();
        let (entered, waiting) = mpsc::channel();
        let stopped_count = session_count.clone();
        let root_copy = root.clone();
        let uninstall = thread::spawn(move || {
            let lock = lifecycle("race.rust").unwrap();
            assert!(lock.try_lock().is_err());
            entered.send(()).unwrap();
            let _uninstalling = lock.lock().unwrap();
            stopped_count.store(0, Ordering::SeqCst);
            remove_package(&root_copy, "race.rust").unwrap();
        });
        waiting.recv_timeout(Duration::from_secs(2)).unwrap();
        session_count.store(1, Ordering::SeqCst); // The already-resolved server finishes spawning.
        drop(starting);
        uninstall.join().unwrap();
        assert_eq!(session_count.load(Ordering::SeqCst), 0);
        assert!(!root.join("race.rust").exists());
    }
    #[test]
    fn zip_extraction_rejects_parent_paths_and_extracts_files() {
        let temporary = tempfile::tempdir().unwrap();
        let archive = temporary.path().join("test.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        writer
            .start_file("bin/server", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"language service").unwrap();
        writer.finish().unwrap();
        let destination = temporary.path().join("plugin");
        fs::create_dir(&destination).unwrap();
        unpack(&archive, "zip", &destination, &AtomicBool::new(false)).unwrap();
        assert_eq!(
            fs::read(destination.join("bin/server")).unwrap(),
            b"language service"
        );
        let mut writer = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        writer
            .start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"bad").unwrap();
        writer.finish().unwrap();
        assert!(unpack(&archive, "zip", &destination, &AtomicBool::new(false)).is_err());
        assert!(!temporary.path().join("escape").exists());
    }
}
