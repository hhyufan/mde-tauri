use base64::{engine::general_purpose, Engine as _};
use encoding_rs::{Encoding, UTF_8};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "android"))]
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{async_runtime, AppHandle, Emitter, Manager};
mod language_plugins;
mod lsp;
#[cfg(windows)]
mod msvc;
mod script_runner;

/// 返回给前端的轻量级文件系统条目元数据，
/// 用于资源管理器界面展示文件和目录。
#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileInfo {
    name: String,
    path: String,
    size: u64,
    is_file: bool,
    is_dir: bool,
    modified: u64,
    modified_ms: u64,
}

/// 文件读写与变更命令共用的标准化返回结构，
/// 便于 WebView 统一处理成功状态、元数据和可选内容。
#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileOperationResult {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_ending: Option<String>,
}

/// 返回给前端的二进制内容与预览元数据，
/// 适用于图片等非文本资源。
#[derive(Serialize, Deserialize, Debug, Clone)]
struct BinaryFileResult {
    content_base64: String,
    mime_type: String,
    size: u64,
}

/// 磁盘上的被监听文件发生变化时，发送给前端的事件载荷。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct FileChangeEvent {
    path: String,
    kind: String,
    modified_at: u64,
    size: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveryTabInput {
    recovery_id: String,
    tab_id: String,
    name: String,
    path: String,
    encoding: String,
    line_ending: String,
    last_saved_hash: String,
    recovery_hash: String,
    modified: bool,
    content: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoverySnapshotInput {
    schema_version: u8,
    updated_at: u64,
    active_tab_id: Option<String>,
    tabs: Vec<RecoveryTabInput>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveryTabManifest {
    recovery_id: String,
    tab_id: String,
    name: String,
    path: String,
    encoding: String,
    line_ending: String,
    last_saved_hash: String,
    recovery_hash: String,
    modified: bool,
    content_file: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifestV1 {
    schema_version: u8,
    updated_at: u64,
    active_tab_id: Option<String>,
    tabs: Vec<RecoveryTabManifest>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveredTab {
    #[serde(flatten)]
    meta: RecoveryTabManifest,
    content: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveredSnapshot {
    schema_version: u8,
    updated_at: u64,
    active_tab_id: Option<String>,
    tabs: Vec<RecoveredTab>,
}

/// 进程内共享的文件监听注册表，
/// 用于持有 `notify` watcher 句柄并记录每个文件最近一次观察到的修改时间。
struct FileWatcherState {
    watchers: HashMap<String, Box<dyn Watcher + Send>>,
    watched_files: HashMap<String, u64>,
}

/// 各个 Tauri 命令之间共享的全局监听状态。
///
/// 只要某个文件仍在被监听，对应的 `notify` watcher 句柄就必须持续被持有。
/// 这里的互斥锁同时也保护用于去重的时间戳，避免同一次保存触发重复的修改事件。
static FILE_WATCHER_STATE: Lazy<Arc<Mutex<FileWatcherState>>> = Lazy::new(|| {
    Arc::new(Mutex::new(FileWatcherState {
        watchers: HashMap::new(),
        watched_files: HashMap::new(),
    }))
});

static CANCELLED_SEARCHES: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static DIAGNOSTIC_LOG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
const DIAGNOSTIC_LOG_LIMIT: u64 = 2 * 1024 * 1024;
const DIAGNOSTIC_LOG_FILES: usize = 5;

/// 检测读取文件时应使用的文本编码。
///
/// 当前实现只区分是否兼容 UTF-8，其余情况统一回退到 UTF-8，
/// 以便桥接层稳定地向前端返回解码结果。
fn detect_file_encoding(bytes: &[u8]) -> &'static Encoding {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return UTF_8;
    }
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    UTF_8
}

/// 检测解码后文本内容的主要换行风格。
///
/// 结果会归一化为 `CRLF`、`CR` 或 `LF`，
/// 便于前端编辑器在保存时保持用户原有的换行约定。
fn detect_line_ending(content: &str) -> String {
    let crlf_count = content.matches("\r\n").count();
    let lf_count = content.matches('\n').count() - crlf_count;
    let cr_count = content.matches('\r').count() - crlf_count;

    if crlf_count > 0 && crlf_count >= lf_count && crlf_count >= cr_count {
        "CRLF".to_string()
    } else if cr_count > 0 && cr_count >= lf_count {
        "CR".to_string()
    } else {
        "LF".to_string()
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn unique_temp_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Target has no parent directory".to_string())?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(parent.join(format!(".{name}.{nonce}.mde-recovery.tmp")))
}

#[cfg(windows)]
fn replace_existing_file(temp: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};

    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temp_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(format!(
            "atomic replace failed: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_existing_file(temp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temp, target).map_err(|error| format!("atomic replace failed: {error}"))
}

/// Write into the destination directory, flush bytes to stable storage and only then
/// replace the destination. On failure the temporary file is intentionally retained as
/// a recovery copy and its path is included in the error.
fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Target has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create directory: {error}"))?;
    let temp = unique_temp_path(target)?;
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("Failed to create recovery file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("Failed to write recovery file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to flush recovery file: {error}"))?;
        drop(file);

        if target.exists() {
            replace_existing_file(&temp, target)?;
        } else {
            fs::rename(&temp, target)
                .map_err(|error| format!("Failed to move recovery file into place: {error}"))?;
        }

        #[cfg(unix)]
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Failed to flush destination directory: {error}"))?;
        Ok(())
    })();

    write_result.map_err(|error| format!("{error}; recovery copy: {}", temp.display()))
}

/// 读取文本文件，并返回解码后的内容与基础编辑器元数据。
#[tauri::command]
async fn read_file_content(path: String) -> Result<FileOperationResult, String> {
    match fs::read(&path) {
        Ok(bytes) => {
            let encoding = detect_file_encoding(&bytes);
            let (content, _, _) = encoding.decode(&bytes);
            let content_str = content.to_string();
            let line_ending = detect_line_ending(&content_str);

            Ok(FileOperationResult {
                success: true,
                message: "File read successfully".to_string(),
                content: Some(content_str),
                file_path: Some(path),
                file_name: None,
                encoding: Some(encoding.name().to_string()),
                line_ending: Some(line_ending),
            })
        }
        Err(e) => Ok(FileOperationResult {
            success: false,
            message: format!("Failed to read file: {}", e),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        }),
    }
}

/// 根据路径扩展名推断二进制文件预览所需的 MIME 类型。
fn guess_mime_from_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// 读取二进制文件，并返回供前端预览的 base64 内容。
#[tauri::command]
async fn read_binary_file(path: String) -> Result<BinaryFileResult, String> {
    let file_path = Path::new(&path);
    let bytes = fs::read(file_path).map_err(|e| format!("Failed to read binary file: {}", e))?;
    Ok(BinaryFileResult {
        content_base64: general_purpose::STANDARD.encode(&bytes),
        mime_type: guess_mime_from_path(file_path).to_string(),
        size: bytes.len() as u64,
    })
}

/// 将原始文本内容写入目标路径，
/// 如果父目录不存在则自动创建。
#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    atomic_write(Path::new(&path), content.as_bytes())
}

/// 按指定编码保存编辑器内容，
/// 并返回前端需要的已落盘文件元数据。
#[tauri::command]
async fn save_file(
    file_path: String,
    content: String,
    encoding: Option<String>,
) -> Result<FileOperationResult, String> {
    if file_path.is_empty() {
        return Ok(FileOperationResult {
            success: false,
            message: "No valid file path provided".to_string(),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        });
    }

    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Ok(FileOperationResult {
                success: false,
                message: format!("Failed to create directory: {}", e),
                content: None,
                file_path: None,
                file_name: None,
                encoding: None,
                line_ending: None,
            });
        }
    }

    let target_encoding = encoding.as_deref().unwrap_or("UTF-8");
    let encoding_obj = Encoding::for_label(target_encoding.as_bytes()).unwrap_or(UTF_8);
    let (encoded_bytes, _, _) = encoding_obj.encode(&content);

    match atomic_write(path, &encoded_bytes) {
        Ok(_) => {
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();

            Ok(FileOperationResult {
                success: true,
                message: "File saved successfully".to_string(),
                content: None,
                file_path: Some(file_path),
                file_name: Some(file_name),
                encoding: Some(encoding_obj.name().to_string()),
                line_ending: Some(detect_line_ending(&content)),
            })
        }
        Err(e) => Ok(FileOperationResult {
            success: false,
            message: format!("Failed to save file: {}", e),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        }),
    }
}

fn recovery_directory(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|path| path.join("recovery"))
        .map_err(|error| format!("Failed to resolve recovery directory: {error}"))
}

#[tauri::command]
async fn write_recovery_snapshot(
    app_handle: AppHandle,
    snapshot: RecoverySnapshotInput,
) -> Result<(), String> {
    if snapshot.schema_version != 1 {
        return Err("Unsupported recovery schema version".to_string());
    }
    let directory = recovery_directory(&app_handle)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create recovery directory: {error}"))?;

    let mut keep_files = std::collections::HashSet::new();
    let mut manifest_tabs = Vec::with_capacity(snapshot.tabs.len());
    for tab in snapshot.tabs {
        let content_hash = sha256_hex(tab.content.as_bytes());
        if !tab.recovery_hash.is_empty() && tab.recovery_hash != content_hash {
            return Err(format!("Recovery hash mismatch for tab {}", tab.tab_id));
        }
        let content_file = format!("{}.draft", sha256_hex(tab.recovery_id.as_bytes()));
        atomic_write(&directory.join(&content_file), tab.content.as_bytes())?;
        keep_files.insert(content_file.clone());
        manifest_tabs.push(RecoveryTabManifest {
            recovery_id: tab.recovery_id,
            tab_id: tab.tab_id,
            name: tab.name,
            path: tab.path,
            encoding: tab.encoding,
            line_ending: tab.line_ending,
            last_saved_hash: tab.last_saved_hash,
            recovery_hash: content_hash,
            modified: tab.modified,
            content_file,
        });
    }

    let manifest = RecoveryManifestV1 {
        schema_version: 1,
        updated_at: snapshot.updated_at,
        active_tab_id: snapshot.active_tab_id,
        tabs: manifest_tabs,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize recovery manifest: {error}"))?;
    atomic_write(&directory.join("manifest.json"), &manifest_bytes)?;

    if let Ok(entries) = fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".draft") && !keep_files.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn read_recovery_snapshot(
    app_handle: AppHandle,
) -> Result<Option<RecoveredSnapshot>, String> {
    let directory = recovery_directory(&app_handle)?;
    let manifest_path = directory.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let manifest: RecoveryManifestV1 = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| format!("Failed to read recovery manifest: {error}"))?,
    )
    .map_err(|error| format!("Failed to parse recovery manifest: {error}"))?;
    if manifest.schema_version != 1 {
        return Err("Unsupported recovery schema version".to_string());
    }

    let tabs = manifest
        .tabs
        .into_iter()
        .filter_map(|meta| {
            let content = fs::read_to_string(directory.join(&meta.content_file)).ok()?;
            if sha256_hex(content.as_bytes()) != meta.recovery_hash {
                return None;
            }
            Some(RecoveredTab { meta, content })
        })
        .collect();
    Ok(Some(RecoveredSnapshot {
        schema_version: manifest.schema_version,
        updated_at: manifest.updated_at,
        active_tab_id: manifest.active_tab_id,
        tabs,
    }))
}

#[tauri::command]
async fn clear_recovery_snapshot(app_handle: AppHandle) -> Result<(), String> {
    let directory = recovery_directory(&app_handle)?;
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read recovery directory: {error}"))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|error| format!("Failed to remove {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

const CREDENTIAL_SERVICE: &str = "com.mde.app";
const REFRESH_TOKEN_ACCOUNT: &str = "refresh-token";

#[tauri::command]
async fn set_refresh_credential(token: String) -> Result<(), String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, REFRESH_TOKEN_ACCOUNT)
        .map_err(|error| format!("Failed to open credential store: {error}"))?
        .set_password(&token)
        .map_err(|error| format!("Failed to save credential: {error}"))
}

#[tauri::command]
async fn get_refresh_credential() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, REFRESH_TOKEN_ACCOUNT)
        .map_err(|error| format!("Failed to open credential store: {error}"))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read credential: {error}")),
    }
}

#[tauri::command]
async fn delete_refresh_credential() -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, REFRESH_TOKEN_ACCOUNT)
        .map_err(|error| format!("Failed to open credential store: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete credential: {error}")),
    }
}

fn diagnostic_directory(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|path| path.join("diagnostics"))
        .map_err(|error| format!("Failed to resolve diagnostics directory: {error}"))
}

fn rotate_diagnostic_logs(directory: &Path) -> Result<(), String> {
    let current = directory.join("mde-0.jsonl");
    if fs::metadata(&current).map(|meta| meta.len()).unwrap_or(0) < DIAGNOSTIC_LOG_LIMIT {
        return Ok(());
    }
    for index in (1..DIAGNOSTIC_LOG_FILES).rev() {
        let source = directory.join(format!("mde-{}.jsonl", index - 1));
        let target = directory.join(format!("mde-{index}.jsonl"));
        if target.exists() {
            let _ = fs::remove_file(&target);
        }
        if source.exists() {
            fs::rename(source, target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn record_diagnostic(
    app_handle: AppHandle,
    category: String,
    duration_ms: Option<u64>,
) -> Result<(), String> {
    let _guard = DIAGNOSTIC_LOG_LOCK.lock().unwrap();
    let directory = diagnostic_directory(&app_handle)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    rotate_diagnostic_logs(&directory)?;
    let safe_category: String = category
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
        .take(64)
        .collect();
    let entry = serde_json::json!({
        "timestamp": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "category": safe_category,
        "durationMs": duration_ms,
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("mde-0.jsonl"))
        .map_err(|error| error.to_string())?;
    writeln!(file, "{entry}").map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn export_diagnostics(app_handle: AppHandle, destination: String) -> Result<(), String> {
    let directory = diagnostic_directory(&app_handle)?;
    let mut logs = Vec::new();
    for index in 0..DIAGNOSTIC_LOG_FILES {
        let path = directory.join(format!("mde-{index}.jsonl"));
        if let Ok(content) = fs::read_to_string(path) {
            logs.push(content);
        }
    }
    let bundle = serde_json::json!({
        "schemaVersion": 1,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "exportedAt": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "privacy": "No document content, tokens, or file paths are recorded.",
        "logs": logs,
    });
    atomic_write(
        Path::new(&destination),
        serde_json::to_string_pretty(&bundle).unwrap().as_bytes(),
    )
}

/// 返回给定路径当前是否存在于磁盘上。
#[tauri::command]
async fn check_file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 返回单个文件或目录路径对应的文件系统元数据。
#[tauri::command]
async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let file_path = Path::new(&path);
    match fs::metadata(&path) {
        Ok(metadata) => {
            let file_name = file_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            Ok(FileInfo {
                name: file_name,
                path: path.clone(),
                size: metadata.len(),
                is_file: metadata.is_file(),
                is_dir: metadata.is_dir(),
                modified: metadata
                    .modified()
                    .map(|time| {
                        time.duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs()
                    })
                    .unwrap_or(0),
                modified_ms: metadata
                    .modified()
                    .map(|time| {
                        time.duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64
                    })
                    .unwrap_or(0),
            })
        }
        Err(e) => Err(format!("Failed to get file info: {}", e)),
    }
}

/// 列出目录的直接子项，
/// 让前端无需递归读取整个工作区也能构建文件树。
#[tauri::command]
async fn get_directory_contents(dir_path: String) -> Result<Vec<FileInfo>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("Provided path is not a directory".to_string());
    }

    match fs::read_dir(path) {
        Ok(entries) => {
            let mut contents = Vec::new();
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    let file_path = entry.path();
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    contents.push(FileInfo {
                        name: file_name,
                        path: file_path.to_string_lossy().to_string(),
                        size: metadata.len(),
                        is_file: metadata.is_file(),
                        is_dir: metadata.is_dir(),
                        modified: metadata
                            .modified()
                            .map(|time| {
                                time.duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs()
                            })
                            .unwrap_or(0),
                        modified_ms: metadata
                            .modified()
                            .map(|time| {
                                time.duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64
                            })
                            .unwrap_or(0),
                    });
                }
            }
            Ok(contents)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

/// 在校验前端工作流所需的源路径和目标路径后，
/// 对文件系统条目执行重命名或移动。
#[tauri::command]
async fn rename_file(old_path: String, new_path: String) -> Result<FileOperationResult, String> {
    if old_path.is_empty() || new_path.is_empty() {
        return Ok(FileOperationResult {
            success: false,
            message: "No valid file path provided".to_string(),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        });
    }

    let old_file_path = Path::new(&old_path);
    let new_file_path = Path::new(&new_path);

    if !old_file_path.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: "Source file does not exist".to_string(),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        });
    }

    if new_file_path.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: "Target file already exists".to_string(),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        });
    }

    match fs::rename(&old_path, &new_path) {
        Ok(_) => {
            let new_file_name = new_file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();

            Ok(FileOperationResult {
                success: true,
                message: "File renamed successfully".to_string(),
                content: None,
                file_path: Some(new_path),
                file_name: Some(new_file_name),
                encoding: None,
                line_ending: None,
            })
        }
        Err(e) => Ok(FileOperationResult {
            success: false,
            message: format!("Failed to rename file: {}", e),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        }),
    }
}

/// 删除文件或目录，并向桥接层返回标准化的操作结果。
#[cfg(target_os = "windows")]
fn move_path_to_recycle_bin(path: &str, is_dir: bool) -> Result<(), String> {
    let escaped = path.replace('\'', "''");
    let command = if is_dir {
        format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('{escaped}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
        )
    } else {
        format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{escaped}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
        )
    };

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .output()
        .map_err(|err| format!("Failed to launch recycle-bin command: {err}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("Failed to move path to recycle bin".to_string())
    } else {
        Err(stderr)
    }
}

#[tauri::command]
async fn delete_file(path: String) -> Result<FileOperationResult, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: "File does not exist".to_string(),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        });
    }

    #[cfg(target_os = "windows")]
    let result = move_path_to_recycle_bin(&path, file_path.is_dir());

    #[cfg(not(target_os = "windows"))]
    let result = if file_path.is_dir() {
        fs::remove_dir_all(&path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(&path).map_err(|err| err.to_string())
    };

    match result {
        Ok(_) => Ok(FileOperationResult {
            success: true,
            message: "Deleted successfully".to_string(),
            content: None,
            file_path: Some(path),
            file_name: None,
            encoding: None,
            line_ending: None,
        }),
        Err(e) => Ok(FileOperationResult {
            success: false,
            message: format!("Failed to delete: {}", e),
            content: None,
            file_path: None,
            file_name: None,
            encoding: None,
            line_ending: None,
        }),
    }
}

/// 开始监听某个文件所在的父目录，并在该文件发生修改时
/// 向前端发出 `file-changed` 事件。
///
/// 监听父目录而不是直接监听文件本身，可以兼容那些通过
/// “先写临时文件、再替换原路径”方式实现保存的编辑器和操作系统。
#[tauri::command]
async fn start_file_watching(app_handle: AppHandle, file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    let app_handle_clone = app_handle.clone();
    let file_path_clone = file_path.clone();

    let initial_modified = match fs::metadata(&file_path) {
        Ok(metadata) => metadata
            .modified()
            .map(|time| {
                time.duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            })
            .unwrap_or(0),
        Err(_) => 0,
    };

    let mut watcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let event_kind = match event.kind {
                EventKind::Modify(notify::event::ModifyKind::Name(_)) => "renamed",
                EventKind::Modify(_) | EventKind::Create(_) => "modified",
                EventKind::Remove(_) => "removed",
                _ => return,
            };
            for path in event.paths {
                if path.to_string_lossy() == file_path_clone {
                    let metadata = fs::metadata(&path).ok();
                    let modified_at = metadata
                        .as_ref()
                        .and_then(|value| value.modified().ok())
                        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                        .map(|value| value.as_millis() as u64)
                        .unwrap_or_else(|| {
                            SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64
                        });

                    // 对比最近一次观察到的修改时间，避免重复的
                    // notify 事件继续扩散成多次 UI 更新。
                    let should_emit = {
                        let mut state = FILE_WATCHER_STATE.lock().unwrap();
                        if let Some(last_modified) = state.watched_files.get_mut(&file_path_clone) {
                            if let Some(metadata) = metadata.as_ref() {
                                if let Ok(modified_time) = metadata.modified() {
                                    let current_modified = modified_time
                                        .duration_since(UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64;
                                    if current_modified != *last_modified {
                                        *last_modified = current_modified;
                                        true
                                    } else {
                                        false
                                    }
                                } else {
                                    true
                                }
                            } else {
                                true
                            }
                        } else {
                            true
                        }
                    };

                    if should_emit {
                        let change_event = FileChangeEvent {
                            path: path.to_string_lossy().to_string(),
                            kind: event_kind.to_string(),
                            modified_at,
                            size: metadata.as_ref().map(|value| value.len()).unwrap_or(0),
                        };
                        let _ = app_handle_clone.emit("file-changed", &change_event);
                    }
                }
            }
        }
    }) {
        Ok(watcher) => watcher,
        Err(e) => return Err(format!("Failed to create file watcher: {}", e)),
    };

    if let Some(parent_dir) = path.parent() {
        if let Err(e) = watcher.watch(parent_dir, RecursiveMode::NonRecursive) {
            return Err(format!("Failed to start watching: {}", e));
        }
    } else {
        return Err("Cannot get parent directory".to_string());
    }

    {
        let mut state = FILE_WATCHER_STATE.lock().unwrap();
        state.watchers.insert(file_path.clone(), Box::new(watcher));
        state
            .watched_files
            .insert(file_path.clone(), initial_modified);
    }

    Ok(true)
}

/// 停止并移除先前为某个文件创建的 watcher。
#[tauri::command]
async fn stop_file_watching(file_path: String) -> Result<bool, String> {
    let mut state = FILE_WATCHER_STATE.lock().unwrap();
    if state.watchers.remove(&file_path).is_some() {
        state.watched_files.remove(&file_path);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 返回给前端的搜索结果项，
/// 用于表示文件名命中或 Markdown 文件内容命中。
#[derive(Serialize, Deserialize, Debug, Clone)]
struct SearchResult {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    matched_line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_number: Option<u32>,
}

/// 判断路径是否使用了递归搜索索引支持的 Markdown 扩展名之一。
fn is_markdown_ext(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let e = ext.to_lowercase();
            e == "md" || e == "markdown" || e == "mdx"
        }
        None => false,
    }
}

/// 内容搜索的第一阶段辅助函数：
/// 先收集 Markdown 文件路径，不立即读取文件内容。
fn collect_md_paths(dir: &Path, out: &mut Vec<std::path::PathBuf>, task_id: &str) {
    if CANCELLED_SEARCHES.lock().unwrap().contains(task_id) || out.len() >= 10_000 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }
        if path.is_dir() {
            collect_md_paths(&path, out, task_id);
        } else if is_markdown_ext(&path) {
            out.push(path);
        }
    }
}

/// 内容搜索的第二阶段辅助函数：
/// 扫描已加载的文件内容，并提取命中行的预览文本。
fn search_content_lines(path: &Path, content: &str, query_lower: &str) -> Vec<SearchResult> {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let path_str = path.to_string_lossy().to_string();
    let mut results = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if line.to_lowercase().contains(query_lower) {
            let preview = if line.len() > 120 {
                format!("{}...", &line[..120])
            } else {
                line.to_string()
            };
            results.push(SearchResult {
                name: name.clone(),
                path: path_str.clone(),
                is_dir: false,
                matched_line: Some(preview),
                line_number: Some((i + 1) as u32),
            });
        }
    }
    results
}

/// 当前端只请求路径匹配而不读取文件内容时，
/// 使用的递归文件名遍历逻辑。
fn walk_names(dir: &Path, query_lower: &str, results: &mut Vec<SearchResult>, limit: usize) {
    if results.len() >= limit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= limit {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }
        if path.is_dir() {
            walk_names(&path, query_lower, results, limit);
        } else if name.to_lowercase().contains(query_lower) {
            results.push(SearchResult {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                matched_line: None,
                line_number: None,
            });
        }
    }
}

/// 按文件名或文件内容搜索 Markdown 文件，
/// 并向前端搜索面板返回轻量结果记录。
#[tauri::command]
async fn search_files(
    dir_path: String,
    query: String,
    search_content: bool,
    max_results: Option<usize>,
    task_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    use std::path::PathBuf;

    let root_path = PathBuf::from(&dir_path);
    if !root_path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    let query_lower: Arc<str> = query.to_lowercase().into();
    let limit = max_results.unwrap_or(100);
    let task_id = task_id.unwrap_or_else(|| {
        format!(
            "search-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
    });
    CANCELLED_SEARCHES.lock().unwrap().remove(&task_id);

    if search_content {
        // 在执行内容扫描前，先在线程池中收集候选 Markdown 路径，
        // 让异步执行器线程继续留给 UI 相关任务使用。
        let root_clone = root_path.clone();
        let collect_task_id = task_id.clone();
        let md_paths = async_runtime::spawn_blocking(move || {
            let mut paths = Vec::new();
            collect_md_paths(&root_clone, &mut paths, &collect_task_id);
            paths
        })
        .await
        .map_err(|e| e.to_string())?;

        // 在线程池中并行读取和扫描文件，
        // 避免大工作区搜索在单线程上串行执行。
        let mut results = Vec::new();
        for batch in md_paths.chunks(4) {
            if results.len() >= limit || CANCELLED_SEARCHES.lock().unwrap().contains(&task_id) {
                break;
            }
            let handles: Vec<_> = batch
                .iter()
                .cloned()
                .map(|path| {
                    let q = Arc::clone(&query_lower);
                    async_runtime::spawn_blocking(move || {
                        if fs::metadata(&path)
                            .map(|meta| meta.len() > 5 * 1024 * 1024)
                            .unwrap_or(true)
                        {
                            return vec![];
                        }
                        match fs::read_to_string(&path) {
                            Ok(content) => search_content_lines(&path, &content, &q),
                            Err(_) => vec![],
                        }
                    })
                })
                .collect();
            for handle in handles {
                if let Ok(file_results) = handle.await {
                    for r in file_results {
                        if results.len() >= limit {
                            break;
                        }
                        results.push(r);
                    }
                }
            }
        }
        CANCELLED_SEARCHES.lock().unwrap().remove(&task_id);
        Ok(results)
    } else {
        // 仅文件名搜索仍放在线程池执行，
        // 因为递归遍历目录本身就是同步文件系统操作。
        let q = query_lower.to_string();
        let results = async_runtime::spawn_blocking(move || {
            let mut out = Vec::new();
            walk_names(&root_path, &q, &mut out, limit);
            out
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(results)
    }
}

#[tauri::command]
async fn cancel_search(task_id: String) -> bool {
    CANCELLED_SEARCHES.lock().unwrap().insert(task_id)
}

/// 在宿主平台的文件管理器中显示指定文件或目录。
#[tauri::command]
async fn show_in_explorer(path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = path;
        return Err("Opening the system file manager is not supported on Android".to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let target_path = Path::new(&path);
        if !target_path.exists() {
            return Err("Path does not exist".to_string());
        }

        #[cfg(target_os = "windows")]
        {
            let args = if target_path.is_file() {
                vec!["/select,".to_string(), path]
            } else {
                vec![path]
            };
            match Command::new("explorer").args(&args).spawn() {
                Ok(_) => Ok("Opened in Explorer".to_string()),
                Err(e) => Err(format!("Failed to open Explorer: {}", e)),
            }
        }

        #[cfg(target_os = "macos")]
        {
            let args = if target_path.is_file() {
                vec!["-R".to_string(), path]
            } else {
                vec![path]
            };
            match Command::new("open").args(&args).spawn() {
                Ok(_) => Ok("Opened in Finder".to_string()),
                Err(e) => Err(format!("Failed to open Finder: {}", e)),
            }
        }

        #[cfg(target_os = "linux")]
        {
            match Command::new("xdg-open")
                .arg(if target_path.is_file() {
                    target_path
                        .parent()
                        .unwrap_or(target_path)
                        .to_str()
                        .unwrap_or(".")
                } else {
                    path.as_str()
                })
                .spawn()
            {
                Ok(_) => Ok("Opened file manager".to_string()),
                Err(e) => Err(format!("Failed to open file manager: {}", e)),
            }
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Err("Operation not supported on this platform".to_string())
        }
    }
}

/// 返回当前应用专属的 `Documents` 目录，
/// 如有必要会先创建该目录。
///
/// 在 Android 上，这是唯一一个无需运行时权限或 Storage Access Framework
/// 就能保证可写的目录。Tauri 在 Android 上会把 `app_data_dir()` 映射到
/// `Context.getFilesDir()`，也就是 `/data/data/<package>/files`：
/// 该目录始终对当前应用可写，对其他应用不可见，并会在卸载时被清空。
/// 在桌面平台上，它会解析到各平台约定的应用数据目录
/// （例如 Windows 上的 `%APPDATA%\com.mde.app`），从而保持行为一致。
#[tauri::command]
async fn get_app_documents_dir(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let docs = app_data_dir.join("Documents");
    if !docs.exists() {
        fs::create_dir_all(&docs).map_err(|e| format!("Failed to create documents dir: {}", e))?;
    }
    Ok(docs.to_string_lossy().to_string())
}

/// 判断路径是否使用了 CLI 交接流程所接受的 Markdown 扩展名之一。
fn is_markdown_file_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "mdown" | "mdwn" | "mkd" | "mkdn")
    )
}

/// 收集传递给应用进程的 Markdown 文件参数。
#[tauri::command]
async fn get_cli_args() -> Result<Vec<String>, String> {
    let current_dir = std::env::current_dir().ok();
    let mut files = Vec::new();

    for arg in std::env::args().skip(1) {
        if arg.is_empty() || arg == "--" || arg.starts_with('-') {
            continue;
        }

        let path = Path::new(&arg);
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else if let Some(dir) = &current_dir {
            dir.join(path)
        } else {
            path.to_path_buf()
        };

        if resolved.is_file() && is_markdown_file_path(&resolved) {
            files.push(resolved.to_string_lossy().to_string());
        }
    }

    Ok(files)
}

/// 确保在桥接层触发的流程结束后，
/// 例如通过外部启动器重新打开文件时，主桌面窗口仍然可见。
#[tauri::command]
async fn show_main_window(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        match app.get_webview_window("main") {
            Some(window) => {
                window
                    .show()
                    .map_err(|e| format!("Failed to show window: {}", e))?;
                Ok(())
            }
            None => Err("Main window not found".to_string()),
        }
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(())
    }
}

/// 在系统默认浏览器中打开外部链接。
///
/// 仅允许 http(s) 与 mailto 协议，避免被用于触发本地命令或打开任意文件。
#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    let allowed =
        url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:");
    if !allowed {
        return Err("Only http(s) and mailto URLs are allowed".to_string());
    }
    open::that(url).map_err(|e| format!("Failed to open URL: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 桌面端 `main()` 与移动端入口共用的 Tauri 启动逻辑。
///
/// 这里统一挂载插件并注册所有可由前端 `invoke` 调用的桥接命令，
/// 让启动配置集中维护在同一个位置。
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // 避免把额外初始化逻辑带入生产启动路径；
    // 只有调试构建才会自动打开 devtools，便于本地排查桥接行为。
    #[cfg(all(debug_assertions, not(target_os = "android")))]
    {
        builder = builder.setup(|app| {
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.open_devtools();
            }
            Ok(())
        });
    }

    builder
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                script_runner::stop_all();
                lsp::stop_all();
                language_plugins::cancel_all();
            }
        })
        // 注册通过 `invoke` 暴露给前端的 Rust <-> WebView 桥接接口。
        .invoke_handler(tauri::generate_handler![
            read_file_content,
            read_binary_file,
            write_file_content,
            save_file,
            write_recovery_snapshot,
            read_recovery_snapshot,
            clear_recovery_snapshot,
            set_refresh_credential,
            get_refresh_credential,
            delete_refresh_credential,
            record_diagnostic,
            export_diagnostics,
            check_file_exists,
            get_file_info,
            get_directory_contents,
            rename_file,
            delete_file,
            start_file_watching,
            stop_file_watching,
            search_files,
            cancel_search,
            show_in_explorer,
            show_main_window,
            get_app_documents_dir,
            get_cli_args,
            open_external,
            script_runner::start_script,
            script_runner::stop_script,
            script_runner::write_script_input,
            lsp::start_lsp,
            lsp::send_lsp,
            lsp::stop_lsp,
            language_plugins::list_language_plugins,
            language_plugins::fetch_language_catalog,
            language_plugins::install_language_plugin,
            language_plugins::cancel_language_plugin_install,
            language_plugins::set_language_plugin_enabled,
            language_plugins::uninstall_language_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_complete_file() {
        let root = std::env::temp_dir().join(format!(
            "mde-atomic-write-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("document.md");
        fs::write(&target, b"original").unwrap();
        atomic_write(&target, b"replacement").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"replacement");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn line_ending_detection_is_stable() {
        assert_eq!(detect_line_ending("a\r\nb\r\n"), "CRLF");
        assert_eq!(detect_line_ending("a\nb\n"), "LF");
    }
}
