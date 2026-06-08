# Tauri的原生Rust Command讲解

## 1. 这篇文档讲什么

这篇文档专门讲当前项目里 Tauri 原生 Rust command 是怎么设计和落地的。  
重点不是只列出有哪些命令，而是解释：

- 它们在项目里的职责边界是什么
- 前端为什么要通过 `invoke` 调它们
- 命令返回结构为什么这样设计
- 哪些命令是文件系统能力，哪些是系统集成能力
- 为什么 Android 上有些命令被显式禁用

如果只先记一句话，可以把这部分理解成：

`前端语义化 API -> Tauri invoke -> Rust command -> 文件系统 / 系统命令 / 事件发射`

---

## 2. Rust command 在项目架构中的位置

前端不是直接读写磁盘，也不会直接去调用系统进程。  
在桌面端，真正和操作系统交互的是 [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L1020-L1041) 里的 Tauri command。

命令注册总入口在 `run()` 里：

代码位置：[lib.rs:L1020-L1041](../src-tauri/src/lib.rs#L1020-L1041)
```rust
builder
    .invoke_handler(tauri::generate_handler![
        read_file_content,
        read_binary_file,
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
        get_app_documents_dir,
        get_cli_args,
    ])
```

这意味着：

- Rust command 是前端可调用的原生能力白名单
- 项目没有把命令注册散落在多个文件里
- 命令的能力面是集中可见、集中维护的

所以理解 Tauri command，首先要从这张“能力总表”开始。

---

## 3. 为什么前端不直接使用 Tauri 插件 API，而要再包一层 Rust command

这个问题很关键。  
因为项目其实已经用了 `fs`、`dialog`、`store` 等 Tauri 插件，但仍然保留了大量自定义 Rust command。

原因主要有 4 个：

### 3.1 需要统一返回结构

例如读文件、保存文件、删除文件，项目希望前端收到的是统一格式，而不是每个 API 各自返回不同形状的数据。

### 3.2 需要补充业务元信息

比如读文本文件时，前端不只需要正文，还需要：

- 编码
- 换行符风格
- 文件名

这些都更适合在 Rust 侧统一处理后返回。

### 3.3 需要原生层完成更高效的工作

例如：

- 递归搜索
- 文件监听
- 打开系统资源管理器
- 执行本地脚本

这些本来就更适合留在原生层。

### 3.4 需要屏蔽平台差异

比如 Android 上某些能力根本不成立，Rust command 可以直接在原生层显式拒绝，避免前端误用。

---

## 4. Rust command 可以按职责分成哪几类

当前项目中的 Rust command 大致可以分成 5 类。

### 4.1 文件读写类

- `read_file_content`
- `read_binary_file`
- `write_file_content`
- `save_file`
- `check_file_exists`
- `get_file_info`
- `get_directory_contents`
- `rename_file`
- `delete_file`

### 4.2 文件监听类

- `start_file_watching`
- `stop_file_watching`

### 4.3 执行与运行类

- `execute_file`
- `run_code_snippet`

### 4.4 搜索类

- `search_files`

### 4.5 桌面系统集成类

- `show_in_explorer`
- `show_main_window`
- `get_app_documents_dir`
- `get_cli_args`

这么拆之后，你再看每个 command，就不会觉得它们只是“一堆零散原生命令”。

---

## 5. 文本读写命令为什么这样设计

### 5.1 `read_file_content` 不只是读文件，还负责解码和换行识别

[../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L112-L259) 中的 `read_file_content()` 如下：

代码位置：[lib.rs:L113-L130](../src-tauri/src/lib.rs#L113-L130)
```rust
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
```

这里最重要的不是 `fs::read` 本身，而是后面的两步：

- `detect_file_encoding(&bytes)`
  - 自动识别编码
- `detect_line_ending(&content_str)`
  - 识别换行风格

这说明 Rust 层不是“把文件原样扔给前端”，而是尽量把前端编辑器真正需要的信息一次带齐。

### 5.2 `save_file` 也不是简单写 UTF-8

代码位置：[lib.rs:L194-L247](../src-tauri/src/lib.rs#L194-L247)
```rust
#[tauri::command]
async fn save_file(
    file_path: String,
    content: String,
    encoding: Option<String>,
) -> Result<FileOperationResult, String> {
    let target_encoding = encoding.as_deref().unwrap_or("UTF-8");
    let encoding_obj = Encoding::for_label(target_encoding.as_bytes()).unwrap_or(UTF_8);
    let (encoded_bytes, _, _) = encoding_obj.encode(&content);

    match fs::write(&file_path, &encoded_bytes) {
        Ok(_) => {
            Ok(FileOperationResult {
                success: true,
                message: "File saved successfully".to_string(),
                file_path: Some(file_path),
                file_name: Some(file_name),
                encoding: Some(encoding_obj.name().to_string()),
                line_ending: Some(detect_line_ending(&content)),
            })
        }
```

这个实现体现了 3 个设计点：

- 允许按目标编码重新编码后落盘
- 返回保存后的统一元信息
- 由 Rust 侧负责保证父目录存在

所以保存命令承担的是“落盘编排”职责，而不是单纯的 `fs::write` 包装。

---

## 6. 为什么还要单独有 `write_file_content`

你会发现项目里同时存在：

- `write_file_content`
- `save_file`

这两个看起来有点像，但职责不同。

`write_file_content` 更偏“原始写入能力”：

代码位置：[lib.rs:L179-L190](../src-tauri/src/lib.rs#L179-L190)
```rust
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
```

它更像：

- 新建空文件
- 简单内容写入
- 不需要保存元信息时的底层工具

而 `save_file` 则是给编辑器保存流程用的。

所以两者不是重复，而是一个偏底层能力，一个偏编辑器落盘。

---

## 7. 文件系统管理类命令为什么要统一在 Rust 侧做

### 7.1 重命名 / 移动

在桌面文件系统里，重命名和移动本质上都可以由 `fs::rename` 完成。  
对应的 `rename_file()` 实现如下：

代码位置：[lib.rs:L342-L400](../src-tauri/src/lib.rs#L342-L400)
```rust
#[tauri::command]
async fn rename_file(old_path: String, new_path: String) -> Result<FileOperationResult, String> {
    if !old_file_path.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: "Source file does not exist".to_string(),
            ...
        });
    }

    if new_file_path.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: "Target file already exists".to_string(),
            ...
        });
    }

    match fs::rename(&old_path, &new_path) {
        Ok(_) => {
            Ok(FileOperationResult {
                success: true,
                message: "File renamed successfully".to_string(),
                file_path: Some(new_path),
                file_name: Some(new_file_name),
                ...
            })
        }
```

这段代码说明，Rust command 不只是直接 rename，而是先把前端工作流需要的前置校验也做掉：

- 源文件是否存在
- 目标路径是否已存在
- 返回统一操作结果

### 7.2 删除

`delete_file()` 也做了统一封装：

代码位置：[lib.rs:L414-L433](../src-tauri/src/lib.rs#L414-L433)
```rust
#[tauri::command]
async fn delete_file(path: String) -> Result<FileOperationResult, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: "File does not exist".to_string(),
            ...
        });
    }

    let result = if file_path.is_dir() {
        fs::remove_dir_all(&path)
    } else {
        fs::remove_file(&path)
    };
```

这里很明显地体现出 Rust command 的价值：

- 对文件和目录统一暴露删除语义
- 前端不用自己先判断是文件还是目录

### 7.3 目录读取

资源管理器依赖 `get_directory_contents()`：

代码位置：[lib.rs:L300-L335](../src-tauri/src/lib.rs#L300-L335)
```rust
#[tauri::command]
async fn get_directory_contents(dir_path: String) -> Result<Vec<FileInfo>, String> {
    match fs::read_dir(path) {
        Ok(entries) => {
            let mut contents = Vec::new();
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    contents.push(FileInfo {
                        name: file_name,
                        path: file_path.to_string_lossy().to_string(),
                        size: metadata.len(),
                        is_file: metadata.is_file(),
                        is_dir: metadata.is_dir(),
                        modified: ...
                    });
                }
            }
            Ok(contents)
        }
```

也就是说，资源管理器不需要递归去自己拼装元信息，Rust 侧直接返回标准目录项列表。

---

## 8. 文件监听命令为什么值得重点看

文件监听是这个项目 Rust command 里比较有代表性的一类能力，因为它不只是简单调用库，而是已经体现出工程化思考。

`start_file_watching()` 的注释就点明了设计原因：

代码位置：[lib.rs:L457-L461](../src-tauri/src/lib.rs#L457-L461)
```rust
/// 开始监听某个文件所在的父目录，并在该文件发生修改时
/// 向前端发出 `file-changed` 事件。
///
/// 监听父目录而不是直接监听文件本身，可以兼容那些通过
/// “先写临时文件、再替换原路径”方式实现保存的编辑器和操作系统。
```

实现里还做了修改时间去重，避免 notify 重复事件扩散成多次 UI 更新：

代码位置：[lib.rs:L485-L530](../src-tauri/src/lib.rs#L485-L530)
```rust
if let EventKind::Modify(_) = event.kind {
    for path in event.paths {
        if path.to_string_lossy() == file_path_clone {
            let should_emit = {
                let mut state = FILE_WATCHER_STATE.lock().unwrap();
                if let Some(last_modified) = state.watched_files.get_mut(&file_path_clone) {
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
                let _ = app_handle_clone.emit("file-changed", &change_event);
            }
        }
    }
}
```

这说明项目不是只想“监听到事件”，而是想把事件质量控制到前端可消费的粒度。

---

## 9. 搜索命令为什么放在 Rust 侧

搜索是另一个非常典型的“必须放原生层”的能力。

`search_files()` 同时支持两种模式：

- 按文件名搜索
- 按内容搜索 Markdown 文件

实现如下：

代码位置：[lib.rs:L773-L800](../src-tauri/src/lib.rs#L773-L800)
```rust
#[tauri::command]
async fn search_files(
    dir_path: String,
    query: String,
    search_content: bool,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let root_path = PathBuf::from(&dir_path);
    if !root_path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    let query_lower: Arc<str> = query.to_lowercase().into();
    let limit = max_results.unwrap_or(100);

    if search_content {
        let md_paths = async_runtime::spawn_blocking(move || {
            let mut paths = Vec::new();
            collect_md_paths(&root_clone, &mut paths);
            paths
        })
        .await?;
```

内容搜索会：

- 先在线程池里收集 Markdown 文件路径
- 再并行读取文件并搜索内容

而文件名搜索则只做目录遍历：

代码位置：[lib.rs:L835-L840](../src-tauri/src/lib.rs#L835-L840)
```rust
let results = async_runtime::spawn_blocking(move || {
    let mut out = Vec::new();
    walk_names(&root_path, &q, &mut out, limit);
    out
})
```

这说明搜索命令不是为了“能搜”，而是为了把目录遍历和文件读取这些重活从前端线程挪到原生层。

---

## 10. 桌面系统集成类命令体现了什么

### 10.1 `show_in_explorer`

这个命令最能体现“跨平台系统集成”的价值，因为它要分别适配：

- Windows Explorer
- macOS Finder
- Linux 文件管理器

实现如下：

代码位置：[lib.rs:L848-L874](../src-tauri/src/lib.rs#L848-L874)
```rust
#[tauri::command]
async fn show_in_explorer(path: String) -> Result<String, String> {
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
```

macOS 和 Linux 也各自走不同命令。  
这说明 Rust command 还承担了“统一系统集成语义”的职责。

### 10.2 `get_app_documents_dir`

代码位置：[lib.rs:L920-L932](../src-tauri/src/lib.rs#L920-L932)
```rust
#[tauri::command]
async fn get_app_documents_dir(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let docs = app_data_dir.join("Documents");
    if !docs.exists() {
        fs::create_dir_all(&docs)
            .map_err(|e| format!("Failed to create documents dir: {}", e))?;
    }
    Ok(docs.to_string_lossy().to_string())
}
```

这个命令的意义不是“拿一个目录路径”这么简单，而是给上层提供统一的“应用私有可写文档目录”语义。

### 10.3 `get_cli_args`

代码位置：[lib.rs:L946-L970](../src-tauri/src/lib.rs#L946-L970)
```rust
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
```

它承担的其实是“文件关联启动参数清洗”职责，而不仅仅是返回 `argv`。

---

## 11. 为什么有些 command 在 Android 上被禁用了

并不是所有桌面能力都能原封不动搬到 Android。  
项目在 Rust 侧对一些命令做了显式禁用，这一点很值得注意。

例如 `execute_file()`：

代码位置：[lib.rs:L575-L581](../src-tauri/src/lib.rs#L575-L581)
```rust
#[tauri::command]
async fn execute_file(file_path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = file_path;
        return Err("Executing local files is not supported on Android".to_string());
    }
```

`run_code_snippet()` 也是一样：

代码位置：[lib.rs:L611-L617](../src-tauri/src/lib.rs#L611-L617)
```rust
#[tauri::command]
async fn run_code_snippet(code: String, language: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = (code, language);
        return Err("Running code snippets is not supported on Android".to_string());
    }
```

`show_in_explorer()` 在 Android 也直接返回不支持。

这说明项目的 Rust command 设计不是“尽量让所有命令 everywhere 都可用”，而是：

- 在能稳定成立的平台上提供能力
- 在不成立的平台上明确拒绝

这种做法比前端默默失败要更可靠。

---

## 12. Rust command 和前端桥接层是如何配合的

前端不会直接 everywhere 使用 `invoke('xxx')`，而是先经过 [../src/utils/tauriApi.js](../src/utils/tauriApi.js#L103-L202)。

例如读取文件时：

代码位置：[tauriApi.js:L125-L125](../src/utils/tauriApi.js#L125-L125)
```js
return invoke('read_file_content', { path });
```

保存文件时：

代码位置：[tauriApi.js:L162-L162](../src/utils/tauriApi.js#L162-L162)
```js
return invoke('save_file', { filePath, content, encoding });
```

列目录时：

代码位置：[tauriApi.js:L201-L201](../src/utils/tauriApi.js#L201-L201)
```js
return invoke('get_directory_contents', { dirPath });
```

这说明 Rust command 的真正定位是：

- 给前端桥接层提供稳定的原生能力点
- 再由前端桥接层把它包装成更接近业务语义的 API

所以你应该把 Rust command 理解成“原生能力面”，而不是“最终业务接口面”。

---

## 13. 建议怎么顺着代码读这一块

如果你要彻底吃透 Tauri Rust command，建议按下面顺序读：

1. [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L1020-L1041)
   - 先看 `run()` 中的 `generate_handler!`
2. [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L112-L259)
   - 看 `read_file_content()` 和 `save_file()`
3. [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L298-L455)
   - 看 `rename_file()`、`delete_file()`、`get_directory_contents()`
4. [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L457-L569)
   - 看 `start_file_watching()` 和 `stop_file_watching()`
5. [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L771-L845)
   - 看 `search_files()`
6. [../src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L847-L971)
   - 看 `show_in_explorer()`、`get_app_documents_dir()`、`get_cli_args()`
7. [../src/utils/tauriApi.js](../src/utils/tauriApi.js#L103-L202)
   - 再回来看前端是如何消费这些命令的

按这个顺序看，会比一上来直接看业务组件更容易建立原生层全局视角。

---

## 14. 结论

当前项目里的 Tauri 原生 Rust command，不是“为了能调 Rust 而调 Rust”，而是清晰地承担了 4 类职责：

- 文件系统能力
  - 读写、保存、目录列表、重命名、删除、存在性检查
- 系统集成能力
  - 打开系统资源管理器、读取 CLI 参数、解析应用私有目录
- 高成本本地能力
  - 搜索、文件监听
- 运行能力
  - 执行脚本、运行代码片段

而它们之所以有价值，不只是因为更快或更底层，而是因为 Rust command 把：

- 平台能力
- 统一返回结构
- 原生层校验
- 平台差异约束

都集中在了一处。

所以从架构角度看，Rust command 这一层的真正作用，是把“前端需要的原生能力面”稳定化、标准化，再让上层桥接和业务模块安心复用。
