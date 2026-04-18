use encoding_rs::{Encoding, UTF_8};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileInfo {
    name: String,
    path: String,
    size: u64,
    is_file: bool,
    is_dir: bool,
    modified: u64,
}

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

#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileChangeEvent {
    file_path: String,
    event_type: String,
    timestamp: u64,
}

struct FileWatcherState {
    watchers: HashMap<String, Box<dyn Watcher + Send>>,
    watched_files: HashMap<String, u64>,
}

static FILE_WATCHER_STATE: Lazy<Arc<Mutex<FileWatcherState>>> = Lazy::new(|| {
    Arc::new(Mutex::new(FileWatcherState {
        watchers: HashMap::new(),
        watched_files: HashMap::new(),
    }))
});

fn detect_file_encoding(bytes: &[u8]) -> &'static Encoding {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return UTF_8;
    }
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    UTF_8
}

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

#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("Failed to create directory: {}", e));
        }
    }
    match fs::write(&path, content) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to write file: {}", e)),
    }
}

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

    match fs::write(&file_path, &encoded_bytes) {
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

#[tauri::command]
async fn check_file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

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
            })
        }
        Err(e) => Err(format!("Failed to get file info: {}", e)),
    }
}

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
                    });
                }
            }
            Ok(contents)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

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

    let result = if file_path.is_dir() {
        fs::remove_dir_all(&path)
    } else {
        fs::remove_file(&path)
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
                    .as_secs()
            })
            .unwrap_or(0),
        Err(_) => 0,
    };

    let mut watcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            if let EventKind::Modify(_) = event.kind {
                for path in event.paths {
                    if path.to_string_lossy() == file_path_clone {
                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        let should_emit = {
                            let mut state = FILE_WATCHER_STATE.lock().unwrap();
                            if let Some(last_modified) =
                                state.watched_files.get_mut(&file_path_clone)
                            {
                                if let Ok(metadata) = fs::metadata(&path) {
                                    if let Ok(modified_time) = metadata.modified() {
                                        let current_modified = modified_time
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs();
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
                                file_path: path.to_string_lossy().to_string(),
                                event_type: "modified".to_string(),
                                timestamp,
                            };
                            let _ = app_handle_clone.emit("file-changed", &change_event);
                        }
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

#[tauri::command]
async fn execute_file(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

    match extension.to_lowercase().as_str() {
        "js" => match Command::new("node").arg(&file_path).output() {
            Ok(output) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
            Err(e) => Err(format!("Failed to execute JS: {}", e)),
        },
        "py" => match Command::new("python").arg(&file_path).output() {
            Ok(output) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
            Err(e) => Err(format!("Failed to execute Python: {}", e)),
        },
        _ => Err(format!("Unsupported file type: {}", extension)),
    }
}

#[tauri::command]
async fn run_code_snippet(code: String, language: String) -> Result<String, String> {
    match language.as_str() {
        "javascript" | "js" => {
            match Command::new("node").arg("-e").arg(&code).output() {
                Ok(output) => {
                    if output.status.success() {
                        Ok(String::from_utf8_lossy(&output.stdout).to_string())
                    } else {
                        Err(String::from_utf8_lossy(&output.stderr).to_string())
                    }
                }
                Err(e) => Err(format!("Failed to run code: {}", e)),
            }
        }
        "python" | "py" => {
            match Command::new("python").arg("-c").arg(&code).output() {
                Ok(output) => {
                    if output.status.success() {
                        Ok(String::from_utf8_lossy(&output.stdout).to_string())
                    } else {
                        Err(String::from_utf8_lossy(&output.stderr).to_string())
                    }
                }
                Err(e) => Err(format!("Failed to run code: {}", e)),
            }
        }
        _ => Err(format!("Unsupported language: {}", language)),
    }
}

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

fn is_markdown_ext(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let e = ext.to_lowercase();
            e == "md" || e == "markdown" || e == "mdx"
        }
        None => false,
    }
}

/// Phase-1 helper: recursively collect markdown file paths without reading content.
fn collect_md_paths(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
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
            collect_md_paths(&path, out);
        } else if is_markdown_ext(&path) {
            out.push(path);
        }
    }
}

/// Phase-2 helper: search matching lines inside a file's content string.
fn search_content_lines(
    path: &Path,
    content: &str,
    query_lower: &str,
) -> Vec<SearchResult> {
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

/// Filename-only recursive walk (no content reading).
fn walk_names(
    dir: &Path,
    query_lower: &str,
    results: &mut Vec<SearchResult>,
    limit: usize,
) {
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
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
        {
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

#[tauri::command]
async fn search_files(
    dir_path: String,
    query: String,
    search_content: bool,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    use std::path::PathBuf;

    let root_path = PathBuf::from(&dir_path);
    if !root_path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    let query_lower: Arc<str> = query.to_lowercase().into();
    let limit = max_results.unwrap_or(100);

    if search_content {
        // Phase 1: collect markdown paths synchronously (stat calls only, fast).
        // Run in spawn_blocking to avoid occupying a Tokio worker thread.
        let root_clone = root_path.clone();
        let md_paths = tokio::task::spawn_blocking(move || {
            let mut paths = Vec::new();
            collect_md_paths(&root_clone, &mut paths);
            paths
        })
        .await
        .map_err(|e| e.to_string())?;

        // Phase 2: read every file concurrently with async I/O, then search its lines.
        let handles: Vec<_> = md_paths
            .into_iter()
            .map(|path| {
                let q = Arc::clone(&query_lower);
                tokio::spawn(async move {
                    match tokio::fs::read_to_string(&path).await {
                        Ok(content) => search_content_lines(&path, &content, &q),
                        Err(_) => vec![],
                    }
                })
            })
            .collect();

        // Phase 3: collect results in discovery order, stop once limit is reached.
        let mut results = Vec::new();
        for handle in handles {
            if results.len() >= limit {
                break;
            }
            if let Ok(file_results) = handle.await {
                for r in file_results {
                    if results.len() >= limit {
                        break;
                    }
                    results.push(r);
                }
            }
        }
        Ok(results)
    } else {
        // Filename search: no content reads, but still move off async thread.
        let q = query_lower.to_string();
        let results = tokio::task::spawn_blocking(move || {
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
async fn show_in_explorer(path: String) -> Result<String, String> {
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
                target_path.parent().unwrap_or(target_path).to_str().unwrap_or(".")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            #[cfg(not(target_os = "android"))]
            {
                if let Some(main_window) = app.get_webview_window("main") {
                    #[cfg(debug_assertions)]
                    {
                        main_window.open_devtools();
                    }
                    app.manage(main_window);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file_content,
            write_file_content,
            save_file,
            check_file_exists,
            get_file_info,
            get_directory_contents,
            rename_file,
            delete_file,
            start_file_watching,
            stop_file_watching,
            execute_file,
            run_code_snippet,
            search_files,
            show_in_explorer,
            show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
