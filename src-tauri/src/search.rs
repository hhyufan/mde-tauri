use encoding_rs::Encoding;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};

static TASKS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    include_excluded: bool,
}

#[derive(Serialize)]
pub struct SearchResult {
    name: String,
    path: String,
    is_dir: bool,
    matched_line: Option<String>,
    line_number: Option<usize>,
    column_number: Option<usize>,
    match_length: Option<usize>,
    score: u32,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    results: Vec<SearchResult>,
    truncated: bool,
    skipped_files: usize,
}

fn normalized(text: &str, sensitive: bool) -> String {
    let text = text.replace('\\', "/");
    if sensitive { text } else { text.to_lowercase() }
}

fn subsequence(text: &str, query: &str) -> bool {
    let mut chars = text.chars();
    query.chars().all(|wanted| chars.by_ref().any(|c| c == wanted))
}

fn file_score(name: &str, relative: &str, query: &str, sensitive: bool) -> Option<u32> {
    let name = normalized(name, sensitive);
    let path = normalized(relative, sensitive);
    let query = normalized(query.trim(), sensitive);
    let rank = if name == query { 0 } else if name.starts_with(&query) { 1 }
        else if name.contains(&query) { 2 } else if path.contains(&query) { 3 }
        else if query.split_whitespace().all(|part| subsequence(&path, part)) { 4 }
        else { return None; };
    Some(rank * 10_000 + name.chars().count().min(9999) as u32)
}

// UTF-8、带 BOM 的 UTF-16 文本可搜索；二进制与大文件跳过并计数。
fn read_text(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > 5 * 1024 * 1024 { return None; }
    let bytes = fs::read(path).ok()?;
    if let Some((encoding, _)) = Encoding::for_bom(&bytes) {
        let (text, _, malformed) = encoding.decode(&bytes);
        return (!malformed).then(|| text.into_owned());
    }
    if bytes.iter().any(|byte| *byte == 0) { return None; }
    String::from_utf8(bytes).ok()
}

// 保存大小写折叠后的字节位置到原文位置的映射，列号使用 Monaco 的 UTF-16 单位。
fn match_range(line: &str, query: &str, sensitive: bool) -> Option<(usize, usize)> {
    if sensitive { return line.find(query).map(|start| (start, start + query.len())); }
    let mut folded = String::new();
    let mut offsets = Vec::new();
    for (start, c) in line.char_indices() {
        let lower = c.to_lowercase().collect::<String>();
        offsets.extend(std::iter::repeat_n((start, start + c.len_utf8()), lower.len()));
        folded.push_str(&lower);
    }
    let needle = query.to_lowercase();
    let start = folded.find(&needle)?;
    Some((offsets[start].0, offsets[start + needle.len() - 1].1))
}

fn content_matches(path: &Path, text: &str, query: &str, options: &SearchOptions, limit: usize) -> Vec<SearchResult> {
    let mut matches = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let Some((start, end)) = match_range(line, query, options.case_sensitive) else { continue; };
        let before = line[..start].chars().count();
        let preview_start = before.saturating_sub(50);
        let preview: String = line.chars().skip(preview_start).take(180).collect();
        matches.push(SearchResult {
            name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(), is_dir: false, score: 0,
            matched_line: Some(format!("{}{}{}", if preview_start > 0 { "…" } else { "" }, preview,
                if line.chars().count() > preview_start + 180 { "…" } else { "" })),
            line_number: Some(index + 1), column_number: Some(line[..start].encode_utf16().count() + 1),
            match_length: Some(line[start..end].encode_utf16().count()),
        });
        if matches.len() >= limit { break; }
    }
    matches
}

fn scan(root: &Path, query: &str, content: bool, limit: usize, options: &SearchOptions, cancelled: &AtomicBool) -> Result<SearchResponse, String> {
    fs::read_dir(root).map_err(|error| format!("Cannot search {}: {error}", root.display()))?;
    let mut response = SearchResponse::default();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        if cancelled.load(Ordering::Relaxed) { break; }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => { response.skipped_files += 1; continue; }
        };
        let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if cancelled.load(Ordering::Relaxed) { break; }
            let Ok(kind) = entry.file_type() else { response.skipped_files += 1; continue; };
            // 不跟随符号链接，避免目录循环和搜索范围越出所选根目录。
            if kind.is_symlink() { continue; }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_dir() {
                let lower = name.to_lowercase();
                if options.include_excluded || !(name.starts_with('.') || ["node_modules", "target", "dist", "build", "vendor", "__pycache__"].contains(&lower.as_str())) {
                    pending.push(path);
                }
            } else if kind.is_file() {
                if content {
                    let Some(text) = read_text(&path) else { response.skipped_files += 1; continue; };
                    response.results.extend(content_matches(&path, &text, query, options, limit + 1 - response.results.len()));
                    if response.results.len() > limit {
                        response.results.truncate(limit);
                        response.truncated = true;
                        return Ok(response);
                    }
                } else if let Some(score) = file_score(&name, &path.strip_prefix(root).unwrap_or(&path).to_string_lossy(), query, options.case_sensitive) {
                    response.results.push(SearchResult { name, path: path.to_string_lossy().into_owned(), is_dir: false,
                        matched_line: None, line_number: None, column_number: None, match_length: None, score });
                    // 始终扫描后续目录，保证精确命中不会被前 100 条模糊结果挤掉。
                    response.results.sort_by(|a, b| a.score.cmp(&b.score).then(a.path.cmp(&b.path)));
                    if response.results.len() > limit { response.results.pop(); response.truncated = true; }
                }
            }
        }
    }
    Ok(response)
}

#[tauri::command]
pub async fn search_files(dir_path: String, query: String, search_content: bool, max_results: Option<usize>, task_id: Option<String>, options: Option<SearchOptions>) -> Result<SearchResponse, String> {
    let query = query.trim().to_string();
    if query.is_empty() { return Ok(SearchResponse::default()); }
    let id = task_id.unwrap_or_else(|| format!("search-{:?}", std::time::SystemTime::now()));
    let flag = Arc::new(AtomicBool::new(false));
    TASKS.lock().unwrap().insert(id.clone(), flag.clone());
    let result = tauri::async_runtime::spawn_blocking(move || scan(&PathBuf::from(dir_path), &query, search_content,
        max_results.unwrap_or(100).clamp(1, 1000), &options.unwrap_or_default(), &flag)).await;
    TASKS.lock().unwrap().remove(&id);
    result.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cancel_search(task_id: String) -> bool {
    if let Some(flag) = TASKS.lock().unwrap().get(&task_id) {
        flag.store(true, Ordering::Relaxed); true
    } else { false }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn includes_dotfiles_code_and_fuzzy_paths() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        fs::write(root.path().join(".env"), "secret=value").unwrap();
        fs::write(root.path().join("src/MonacoEditor.jsx"), "const 中文 = 'needle';").unwrap();
        assert_eq!(scan(root.path(), ".env", false, 20, &SearchOptions::default(), &AtomicBool::new(false)).unwrap().results.len(), 1);
        assert_eq!(scan(root.path(), "src/mejsx", false, 20, &SearchOptions::default(), &AtomicBool::new(false)).unwrap().results.len(), 1);
        assert_eq!(scan(root.path(), "needle", true, 20, &SearchOptions::default(), &AtomicBool::new(false)).unwrap().results.len(), 1);
    }
    #[test]
    fn long_chinese_and_utf16_columns_are_safe() {
        let text = format!("{}😀needle{}", "文".repeat(150), "文".repeat(200));
        let hits = content_matches(Path::new("a.kt"), &text, "needle", &SearchOptions::default(), 10);
        assert_eq!(hits[0].column_number, Some(153));
        assert!(hits[0].matched_line.as_ref().unwrap().contains("needle"));
        assert_eq!(match_range("İxxNeedle", "needle", false), Some((4, 10)));
    }
    #[test]
    fn prioritizes_exact_match_after_limit_and_respects_exclusions() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..10 { fs::write(root.path().join(format!("a-{i}-foo.txt")), "foo").unwrap(); }
        fs::write(root.path().join("foo"), "Foo").unwrap();
        fs::create_dir(root.path().join("node_modules")).unwrap();
        fs::write(root.path().join("node_modules/hidden.txt"), "needle").unwrap();
        let hits = scan(root.path(), "foo", false, 1, &SearchOptions::default(), &AtomicBool::new(false)).unwrap();
        assert_eq!(hits.results[0].name, "foo"); assert!(hits.truncated);
        assert!(scan(root.path(), "hidden", false, 20, &SearchOptions::default(), &AtomicBool::new(false)).unwrap().results.is_empty());
        let options = SearchOptions { include_excluded: true, case_sensitive: true };
        assert_eq!(scan(root.path(), "hidden", false, 20, &options, &AtomicBool::new(false)).unwrap().results.len(), 1);
        assert!(scan(root.path(), "foo", false, 20, &options, &AtomicBool::new(true)).unwrap().results.is_empty());
    }
    #[test]
    fn skips_binary_and_reports_limit_and_case() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.bin"), [0, 1, 2]).unwrap();
        fs::write(root.path().join("b.cs"), "needle\nNEEDLE\nneedle").unwrap();
        let hits = scan(root.path(), "needle", true, 2, &SearchOptions::default(), &AtomicBool::new(false)).unwrap();
        assert_eq!(hits.results.len(), 2); assert!(hits.truncated); assert_eq!(hits.skipped_files, 1);
        let options = SearchOptions { case_sensitive: true, ..SearchOptions::default() };
        assert_eq!(scan(root.path(), "needle", true, 10, &options, &AtomicBool::new(false)).unwrap().results.len(), 2);
    }
}
