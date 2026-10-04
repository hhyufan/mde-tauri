use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tempfile::{NamedTempFile, TempDir};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRequest {
    run_id: String,
    language: String,
    source: String,
    file_path: Option<String>,
    runtime_path: Option<String>,
    cache_key: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEvent {
    run_id: String,
    kind: String,
    text: String,
    exit_code: Option<i32>,
    elapsed_ms: u128,
    cancelled: bool,
}

type Sink = Arc<dyn Fn(ScriptEvent) + Send + Sync>;
#[derive(Default)]
struct RunControl {
    cancelled: AtomicBool,
    input: Mutex<Option<ChildStdin>>,
}
static RUNS: Lazy<Mutex<HashMap<String, Arc<RunControl>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(super) fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

fn executable(path: &Path) -> bool {
    // Windows App Execution Aliases are zero-byte stubs and can open the Store.
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false)
}

/// 命令在 PATH 目录里可能的文件名：Windows 上 kotlinc 是 .bat，python 是 .exe。
fn launcher_names(directory: &Path, name: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        [".exe", ".cmd", ".bat", ""]
            .into_iter()
            .map(|suffix| directory.join(format!("{name}{suffix}")))
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![directory.join(name)]
    }
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default()
}

fn runtime_in(directory: &Path, name: &str) -> Option<PathBuf> {
    launcher_names(directory, name)
        .into_iter()
        .find(|candidate| executable(candidate) && (name != "java" || javac_for(candidate).is_ok()))
}

/// Dedicated homes take precedence over PATH; filesystem discovery is a fallback.
fn environment_runtime(
    names: &[&str],
    homes: &[PathBuf],
    paths: &[PathBuf],
) -> Option<(PathBuf, Vec<String>)> {
    for home in homes {
        for directory in [home.join("bin"), home.clone()] {
            for name in names {
                if let Some(found) = runtime_in(&directory, name) {
                    return Some((found, vec![]));
                }
            }
        }
    }
    for name in names {
        for directory in paths {
            if let Some(found) = runtime_in(directory, name) {
                return Some((
                    found,
                    if *name == "py" {
                        vec!["-3".into()]
                    } else {
                        vec![]
                    },
                ));
            }
        }
    }
    None
}

/// 目录名字像 JDK/JRE 才继续下钻，避免为了找 JDK 遍历整棵目录树。
#[cfg(windows)]
fn looks_like_jdk(path: &Path) -> bool {
    const KEYWORDS: [&str; 10] = [
        "jdk", "jre", "java", "openjdk", "graalvm", "temurin", "zulu", "corretto", "adoptium",
        "liberica",
    ];
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    KEYWORDS.iter().any(|keyword| name.contains(keyword))
}

/// 目录名里的第一个数字，用来按版本而不是按字典序排 JDK 目录
/// （字典序会把 jdk-8 排在 jdk-25 前面）。
#[cfg(windows)]
fn version_number(path: &Path) -> Option<u64> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let digits: String = name
        .chars()
        .skip_while(|character| !character.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// 新的版本排在前面。
#[cfg(windows)]
fn sort_versions_descending(paths: &mut [PathBuf]) {
    paths.sort_by_key(|path| std::cmp::Reverse((version_number(path).unwrap_or(0), path.clone())));
}

/// 在发行版根目录（如 `C:\Program Files\Eclipse Adoptium`）下按 `<版本>/<相对路径>` 查找。
#[cfg(windows)]
fn scan_versioned(roots: &[PathBuf], relative: &str, candidates: &mut Vec<PathBuf>) {
    for root in roots {
        candidates.push(root.join(relative));
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        let mut children: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        sort_versions_descending(&mut children);
        for child in children {
            candidates.push(child.join(relative));
        }
    }
}

/// PATH 里开发工具目录的上层目录：JDK 常被解压在这类目录下
/// （例如 PATH 含 C:\Env\cargo\bin 时，C:\Env\jdk\jdk-21 也能被发现）。
#[cfg(windows)]
fn development_roots(path_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots = vec![];
    if let Some(drive) = std::env::var_os("SystemDrive") {
        let drive = PathBuf::from(format!("{}\\", drive.to_string_lossy()));
        for directory in ["Env", "Tools", "Dev", "Development", "Java", "Kotlin"] {
            roots.push(drive.join(directory));
        }
    }
    for directory in path_dirs {
        if let Some(parent) = directory.parent() {
            roots.push(parent.to_path_buf());
            if let Some(grandparent) = parent.parent() {
                roots.push(grandparent.to_path_buf());
            }
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

/// 目录名像 Kotlin 发行包才继续下钻。
#[cfg(windows)]
fn looks_like_kotlin(path: &Path) -> bool {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
        .contains("kotlin")
}

/// 在开发工具根目录下按 `<名称>/[子目录]/bin/kotlinc.bat` 找 Kotlin 编译器。
#[cfg(windows)]
fn scan_kotlin_roots(roots: &[PathBuf], candidates: &mut Vec<PathBuf>) {
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        let mut directories: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir() && looks_like_kotlin(path))
            .collect();
        sort_versions_descending(&mut directories);
        for directory in directories {
            candidates.push(directory.join("bin").join("kotlinc.bat"));
            let Ok(nested) = fs::read_dir(&directory) else {
                continue;
            };
            let mut nested: Vec<PathBuf> = nested
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir() && looks_like_kotlin(path))
                .collect();
            sort_versions_descending(&mut nested);
            for child in nested {
                candidates.push(child.join("bin").join("kotlinc.bat"));
            }
        }
    }
}

/// 在开发工具根目录下按 `<名称>/[子目录]/bin/java.exe` 找 JDK。
#[cfg(windows)]
fn scan_jdk_roots(roots: &[PathBuf], candidates: &mut Vec<PathBuf>) {
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        let mut versions: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir() && looks_like_jdk(path))
            .collect();
        sort_versions_descending(&mut versions);
        for version in versions {
            candidates.push(version.join("bin").join("java.exe"));
            let Ok(nested) = fs::read_dir(&version) else {
                continue;
            };
            let mut nested: Vec<PathBuf> = nested
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir() && looks_like_jdk(path))
                .collect();
            sort_versions_descending(&mut nested);
            for directory in nested {
                candidates.push(directory.join("bin").join("java.exe"));
            }
        }
    }
}

fn fingerprint(source: &str) -> String {
    format!("{:x}", Sha256::digest(source.as_bytes()))
}

// Language servers can lag behind the newest JDK supported by the script runner.
// Inspect the JDK release file instead of blindly selecting the highest installed version.
pub(super) fn find_lsp_java(min: u32, max: u32) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok((java, _)) = find_runtime("java", None) {
        candidates.push(java.clone());
        if let Some(root) = java.parent().and_then(Path::parent).and_then(Path::parent) {
            if let Ok(entries) = fs::read_dir(root) {
                for entry in entries.flatten() {
                    candidates.extend(launcher_names(&entry.path().join("bin"), "java"));
                }
            }
        }
    }
    for variable in ["JAVA_HOME", "JDK_HOME"] {
        if let Some(home) = std::env::var_os(variable) {
            candidates.extend(launcher_names(&PathBuf::from(home).join("bin"), "java"));
        }
    }
    for path in path_dirs() {
        candidates.extend(launcher_names(&path, "java"));
    }
    #[cfg(windows)]
    scan_jdk_roots(&development_roots(&path_dirs()), &mut candidates);
    #[cfg(not(windows))]
    for root in ["/usr/lib/jvm", "/Library/Java/JavaVirtualMachines"] {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin/java"));
                candidates.push(entry.path().join("Contents/Home/bin/java"));
            }
        }
    }
    let mut versions: Vec<_> = candidates
        .into_iter()
        .filter_map(|java| {
            let java = crate::language_plugins::normal_path(java.canonicalize().ok()?);
            if !executable(&java) {
                return None;
            }
            let release = fs::read_to_string(java.parent()?.parent()?.join("release")).ok()?;
            let version = release
                .lines()
                .find_map(|line| line.strip_prefix("JAVA_VERSION="))?
                .trim_matches('"');
            let version = version.strip_prefix("1.").unwrap_or(version);
            let major: u32 = version
                .split(|c: char| !c.is_ascii_digit())
                .next()?
                .parse()
                .ok()?;
            (min <= major && major <= max).then_some((major, java))
        })
        .collect();
    versions.sort_by_key(|(major, _)| std::cmp::Reverse(*major));
    versions.into_iter().next().map(|(_, path)| path).ok_or_else(||
        format!("语言服务需要 JDK {min}–{max}，请安装兼容的 JDK。脚本运行可以继续使用其他 JDK 版本。"))
}

fn has_extension(path: Option<&str>, extension: &str) -> bool {
    path.map(Path::new)
        .and_then(Path::extension)
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
}

pub(super) fn find_runtime(
    language: &str,
    custom: Option<&str>,
) -> Result<(PathBuf, Vec<String>), String> {
    let names: &[&str] = match language {
        "javascript" => &["node"],
        "python" => &["python", "python3", "py"],
        "csharp" => &["dotnet"],
        "java" => &["java"],
        // Kotlin 用 kotlinc 编译；运行编译产物时另外查找 java。
        "kotlin" => &["kotlinc"],
        "rust" => &["rustc"],
        _ => {
            return Err("支持运行 .cs、.js、.mjs、.cjs、.py、.java、.kt、.kts 和 .rs 文件。".into())
        }
    };
    if let Some(custom) = custom.filter(|path| !path.trim().is_empty()) {
        // 粘贴路径时常带着引号或尾随空格。
        let path = PathBuf::from(custom.trim().trim_matches('"').trim());
        if !path.is_absolute() {
            return Err("运行环境路径无效，请填写绝对路径。".into());
        }
        // 可以直接填安装目录（JDK 主目录、Kotlin 编译器目录），也可以填 bin 目录或
        // 可执行文件本身：手动配置时很难记住官方目录层级。
        if path.is_dir() {
            for name in names {
                for directory in [path.clone(), path.join("bin")] {
                    if let Some(found) = launcher_names(&directory, name)
                        .into_iter()
                        .find(|candidate| executable(candidate))
                    {
                        return Ok((found, vec![]));
                    }
                }
            }
            return Err(format!(
                "在 {} 里找不到运行环境，请指向可执行文件或包含它的安装目录。",
                path.display()
            ));
        }
        if !executable(&path) {
            return Err("运行环境路径无效，请指定解释器可执行文件的绝对路径。".into());
        }
        return Ok((path, vec![]));
    }
    let path_dirs = path_dirs();
    let variables: &[&str] = match language {
        "java" => &["JAVA_HOME", "JDK_HOME"],
        "kotlin" => &["KOTLIN_HOME"],
        "csharp" => &["DOTNET_ROOT"],
        "rust" => &["CARGO_HOME"],
        _ => &[],
    };
    let homes: Vec<_> = variables
        .iter()
        .filter_map(|name| std::env::var_os(name))
        .filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home.to_string_lossy().trim().trim_matches('"')))
        .collect();
    if language == "rust" {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            if let Some(runtime) =
                environment_runtime(names, &[PathBuf::from(home).join(".cargo")], &[])
            {
                // Explicit CARGO_HOME and PATH still take precedence over the default home.
                if environment_runtime(names, &homes, &path_dirs).is_none() {
                    return Ok(runtime);
                }
            }
        }
    }
    if let Some(runtime) = environment_runtime(names, &homes, &path_dirs) {
        return Ok(runtime);
    }
    #[cfg(windows)]
    {
        let mut candidates = vec![];
        if language == "csharp" {
            if let Some(root) = std::env::var_os("ProgramFiles") {
                candidates.push(PathBuf::from(root).join("dotnet/dotnet.exe"));
            }
        }
        if language == "python" {
            let mut roots = vec![];
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                roots.push(PathBuf::from(local).join("Programs/Python"));
            }
            // Also discover Python beside PATH entries in development-tool folders.
            roots.extend(
                path_dirs
                    .iter()
                    .filter_map(|dir| dir.parent().map(Path::to_path_buf)),
            );
            roots.sort();
            roots.dedup();
            for root in roots {
                if let Ok(entries) = fs::read_dir(root) {
                    for entry in entries.flatten() {
                        if entry
                            .file_name()
                            .to_string_lossy()
                            .to_lowercase()
                            .starts_with("python")
                        {
                            candidates.push(entry.path().join("python.exe"));
                        }
                    }
                }
            }
        }
        if language == "java" {
            // 各家 JDK 发行版在 Program Files 下的 <版本>/bin/java.exe。
            let mut roots = vec![];
            for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
                if let Some(root) = std::env::var_os(variable) {
                    let root = PathBuf::from(root);
                    for vendor in [
                        "Java",
                        "Eclipse Adoptium",
                        "Microsoft",
                        "Amazon Corretto",
                        "Zulu",
                        "BellSoft",
                        "Programs/Eclipse Adoptium",
                        "Programs/Microsoft",
                        "Programs/Java",
                    ] {
                        roots.push(root.join(vendor));
                    }
                }
            }
            if let Some(profile) = std::env::var_os("USERPROFILE") {
                let profile = PathBuf::from(profile);
                for location in [
                    ".jdks",
                    ".sdkman/candidates/java",
                    "scoop/apps/openjdk",
                    "scoop/apps/temurin",
                    "scoop/apps/java",
                ] {
                    roots.push(profile.join(location));
                }
            }
            scan_versioned(&roots, "bin/java.exe", &mut candidates);
            scan_jdk_roots(&development_roots(&path_dirs), &mut candidates);
        }
        if language == "kotlin" {
            // Kotlin 编译器发行包（kotlin-compiler）解压或安装后的常见位置。
            let mut roots = vec![];
            for variable in ["ProgramFiles", "LOCALAPPDATA", "USERPROFILE"] {
                if let Some(root) = std::env::var_os(variable) {
                    let root = PathBuf::from(root);
                    for location in [
                        "Kotlin",
                        "kotlin",
                        "Programs/Kotlin",
                        "scoop/apps/kotlin/current",
                        ".sdkman/candidates/kotlin",
                    ] {
                        roots.push(root.join(location));
                    }
                }
            }
            scan_versioned(&roots, "bin/kotlinc.bat", &mut candidates);
            scan_kotlin_roots(&development_roots(&path_dirs), &mut candidates);
        }
        if let Some(path) = candidates
            .into_iter()
            .find(|path| executable(path) && (language != "java" || javac_for(path).is_ok()))
        {
            return Ok((path, vec![]));
        }
    }
    let name = match language {
        "csharp" => ".NET SDK",
        "python" => "Python 3",
        "java" => "JDK（java）",
        "kotlin" => "Kotlin 编译器（kotlinc）",
        "rust" => "Rust 编译器（rustc）",
        _ => "Node.js",
    };
    Err(format!(
        "未找到 {name}。请安装运行环境，或在控制台的“运行环境”中指定可执行文件。"
    ))
}

#[derive(Clone)]
struct RoslynCompiler {
    path: PathBuf,
    references: Vec<PathBuf>,
    identity: String,
}

#[derive(Clone)]
struct DotnetSdk {
    framework: String,
    roslyn: Option<RoslynCompiler>,
}

pub(super) fn lsp_dotnet_framework() -> Result<String, String> {
    let (runtime, _) = find_runtime("csharp", None)?;
    Ok(dotnet_sdk(&runtime)?.framework)
}

type SdkStamp = Vec<Option<std::time::SystemTime>>;
static SDK_CACHE: Lazy<Mutex<HashMap<PathBuf, (SdkStamp, DotnetSdk)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn dotnet_sdk(runtime: &Path) -> Result<DotnetSdk, String> {
    let root = java_environment_path(runtime)
        .parent()
        .unwrap_or(runtime)
        .to_path_buf();
    let stamp: SdkStamp = [
        runtime.to_path_buf(),
        root.join("sdk"),
        root.join("packs/Microsoft.NETCore.App.Ref"),
    ]
    .iter()
    .map(|path| fs::metadata(path).ok()?.modified().ok())
    .collect();
    // SDK 清单在进程内复用，二次 F5 不再启动 dotnet --list-sdks；安装目录变化时重新发现。
    if let Some((cached_stamp, sdk)) = SDK_CACHE.lock().unwrap().get(runtime) {
        if *cached_stamp == stamp {
            return Ok(sdk.clone());
        }
    }
    let result = command(runtime)
        .arg("--list-sdks")
        .output()
        .map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&result.stdout);
    let mut sdks = text
        .lines()
        .filter_map(|line| {
            let (version, directory) = line.trim().rsplit_once(" [")?;
            let numbers = numeric_version(version)?;
            (numbers[0] >= 6).then(|| {
                (
                    numbers,
                    version.to_string(),
                    PathBuf::from(directory.trim_end_matches(']')),
                )
            })
        })
        .collect::<Vec<_>>();
    sdks.sort_by(|a, b| b.0.cmp(&a.0));
    let Some((version, name, sdk_root)) = sdks.first() else {
        return Err("运行 C# 需要 .NET 6 或更高版本 SDK，仅安装运行时不够。".into());
    };
    let framework = format!("net{}.0", version[0]);
    let compiler = sdk_root.join(name).join("Roslyn/bincore/csc.dll");
    let packs = sdk_root
        .parent()
        .unwrap_or(&root)
        .join("packs/Microsoft.NETCore.App.Ref");
    let mut references = fs::read_dir(&packs)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let numbers = numeric_version(&entry.file_name().to_string_lossy())?;
            let directory = path.join("ref").join(&framework);
            (numbers[0] == version[0] && directory.is_dir()).then_some((numbers, directory))
        })
        .collect::<Vec<_>>();
    references.sort_by(|a, b| b.0.cmp(&a.0));
    let roslyn = references.first().and_then(|(_, directory)| {
        let mut dlls = fs::read_dir(directory)
            .ok()?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| has_extension(path.to_str(), "dll"))
            .collect::<Vec<_>>();
        dlls.sort();
        (compiler.is_file() && directory.join("System.Runtime.dll").is_file()).then(|| {
            RoslynCompiler {
                path: compiler.clone(),
                references: dlls,
                identity: format!("roslyn-v2:{}:{}", compiler.display(), directory.display()),
            }
        })
    });
    let sdk = DotnetSdk { framework, roslyn };
    SDK_CACHE
        .lock()
        .unwrap()
        .insert(runtime.to_path_buf(), (stamp, sdk.clone()));
    Ok(sdk)
}

fn numeric_version(version: &str) -> Option<[u32; 3]> {
    let mut parts = version.split(['.', '-']);
    Some([
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ])
}

fn prepare_roslyn(
    runtime: &Path,
    compiler: &RoslynCompiler,
    project: &Path,
    output: &Path,
    framework: &str,
    cwd: &Path,
) -> Result<Command, String> {
    fs::create_dir_all(output).map_err(|error| error.to_string())?;
    // 直接调用 SDK 自带的 Roslyn，跳过 MSBuild/NuGet 求值，也不创建常驻编译服务。
    // 补齐原控制台项目的隐式 using、条件编译符号与程序集信息，保持单文件程序语义。
    let major = framework
        .trim_start_matches("net")
        .split('.')
        .next()
        .unwrap()
        .parse::<u32>()
        .unwrap();
    let generated = project.join("Run.Generated.cs");
    write_if_changed(&generated, &format!(
        "global using global::System;\nglobal using global::System.Collections.Generic;\nglobal using global::System.IO;\nglobal using global::System.Linq;\nglobal using global::System.Net.Http;\nglobal using global::System.Threading;\nglobal using global::System.Threading.Tasks;\n[assembly: System.Reflection.AssemblyVersion(\"1.0.0.0\")]\n[assembly: System.Reflection.AssemblyFileVersion(\"1.0.0.0\")]\n[assembly: System.Reflection.AssemblyInformationalVersion(\"1.0.0\")]\n[assembly: System.Reflection.AssemblyCompany(\"Run\")]\n[assembly: System.Reflection.AssemblyProduct(\"Run\")]\n[assembly: System.Reflection.AssemblyTitle(\"Run\")]\n[assembly: System.Reflection.AssemblyConfiguration(\"Debug\")]\n[assembly: System.Runtime.Versioning.TargetFramework(\".NETCoreApp,Version=v{major}.0\", FrameworkDisplayName = \".NET {major}.0\")]\n"
    ))?;
    // dotnet run 会准备 UTF-8 管道；绕过 CLI 后在模块初始化阶段恢复同样的输入输出编码。
    // 用户 main/顶层语句随后仍可自行设置编码，编译阶段继续使用 -utf8output。
    let encoding = project.join("Run.Encoding.cs");
    let encoding_namespace = fingerprint(&project.to_string_lossy());
    write_if_changed(&encoding, &format!("namespace Mde.Generated._{encoding_namespace} {{ internal static class Startup {{ [global::System.Runtime.CompilerServices.ModuleInitializer] internal static void Initialize() {{ global::System.Console.InputEncoding = new global::System.Text.UTF8Encoding(false); global::System.Console.OutputEncoding = new global::System.Text.UTF8Encoding(false); }} }} }}"))?;
    let mut defines = vec![
        "DEBUG".into(),
        "TRACE".into(),
        "NET".into(),
        "NETCOREAPP".into(),
        format!("NET{major}_0"),
    ];
    defines.extend((5..=major).map(|version| format!("NET{version}_0_OR_GREATER")));
    defines.extend(
        ["1_0", "1_1", "2_0", "2_1", "2_2", "3_0", "3_1"]
            .map(|version| format!("NETCOREAPP{version}_OR_GREATER")),
    );
    let quote = |path: &Path| format!("\"{}\"", path.to_string_lossy().replace('"', "\\\""));
    let mut options = vec![
        "-nologo".into(),
        "-nostdlib+".into(),
        "-target:exe".into(),
        "-nullable:enable".into(),
        "-utf8output".into(),
        "-deterministic+".into(),
        "-debug:portable".into(),
        "-optimize-".into(),
        format!("-langversion:{}.0", major + 4),
        format!("-define:{}", defines.join(";")),
        format!("-out:{}", quote(&output.join("Run.dll"))),
    ];
    options.extend(
        compiler
            .references
            .iter()
            .map(|path| format!("-reference:{}", quote(path))),
    );
    options.push(quote(&generated));
    options.push(quote(&encoding));
    options.push(quote(&project.join("Program.cs")));
    let response = project.join("Run.rsp");
    // 响应文件避免 Windows 命令行长度限制；引用列表未变时不重写。
    write_if_changed(&response, &options.join("\n"))?;
    write_if_changed(&output.join("Run.runtimeconfig.json"), &serde_json::json!({
        "runtimeOptions": {"tfm": framework, "framework": {"name": "Microsoft.NETCore.App", "version": format!("{major}.0.0")}}
    }).to_string())?;
    let target = format!(".NETCoreApp,Version=v{major}.0");
    write_if_changed(
        &output.join("Run.deps.json"),
        &serde_json::json!({
            "runtimeTarget": {"name": target, "signature": ""}, "compilationOptions": {},
            "targets": {target: {"Run/1.0.0": {"runtime": {"Run.dll": {}}}}},
            "libraries": {"Run/1.0.0": {"type": "project", "serviceable": false, "sha512": ""}}
        })
        .to_string(),
    )?;
    let mut cmd = command(runtime);
    cmd.arg(&compiler.path)
        .arg("-noconfig")
        .arg(format!("@{}", response.display()))
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(cmd)
}

/// 同一个 JDK / Kotlin 目录里的另一个可执行文件（java ↔ javac、kotlin ↔ kotlinc）。
fn sibling_tool(tool: &Path, name: &str) -> Option<PathBuf> {
    let directory = tool.parent()?;
    launcher_names(directory, name)
        .into_iter()
        .find(|candidate| executable(candidate))
}

fn tool_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// Keep java and javac in the same JDK, including PATH symlinks.
fn javac_for(java: &Path) -> Result<PathBuf, String> {
    if let Some(sibling) = sibling_tool(java, "javac") {
        return Ok(sibling);
    }
    if let Ok(resolved) = fs::canonicalize(java) {
        if let Some(sibling) = sibling_tool(&resolved, "javac") {
            return Ok(sibling);
        }
    }
    Err("运行 Java 需要 JDK（找不到 javac）。请安装 JDK，或在“运行环境”中指定 JDK 的 java 可执行文件。".into())
}

/// Java 需要 java 与 javac 两个可执行文件，用户给其中任意一个都要能用：
/// 给 javac.exe 时改用同目录的 java 运行，给 java.exe 时再找同目录的 javac。
fn java_toolchain(runtime: &Path) -> Result<(PathBuf, PathBuf), String> {
    if tool_stem(runtime) == "javac" {
        return sibling_tool(runtime, "java")
            .map(|java| (java, runtime.to_path_buf()))
            .ok_or_else(|| {
                "指定的 javac 同目录下没有 java，请改为指定 JDK 的 bin 目录或 bin/java。".into()
            });
    }
    let javac = javac_for(runtime)?;
    Ok((runtime.to_path_buf(), javac))
}

/// Kotlin 的“运行环境”应当是编译器 kotlinc；填了 kotlin 运行器时自动换成同目录的 kotlinc。
fn kotlin_compiler(runtime: &Path) -> Result<PathBuf, String> {
    if tool_stem(runtime) != "kotlin" {
        return Ok(runtime.to_path_buf());
    }
    sibling_tool(runtime, "kotlinc").ok_or_else(|| {
        "指定的 kotlin 同目录下没有 kotlinc，请改为指定 Kotlin 编译器的 bin/kotlinc。".into()
    })
}

/// Kotlin uses the selected Java for both the compiler JVM and the generated program.
fn find_java(kotlinc: &Path) -> Result<PathBuf, String> {
    if let Ok((java, _)) = find_runtime("java", None) {
        return Ok(java);
    }
    if let Some(directory) = kotlinc.parent() {
        for candidate in launcher_names(directory, "java") {
            if executable(&candidate) {
                return Ok(candidate);
            }
        }
    }
    Err("运行 Kotlin 需要 Java：未找到 JDK，请设置 JAVA_HOME，或安装 JDK 后重试。".into())
}

fn java_environment_path(java: &Path) -> PathBuf {
    let java = fs::canonicalize(java).unwrap_or_else(|_| java.to_path_buf());
    // canonicalize uses the extended Windows prefix. Batch launchers and JVM
    // installation lookup require a regular DOS/UNC path instead.
    #[cfg(windows)]
    {
        let text = java.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(path) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(path);
        }
    }
    java
}

fn kotlin_java_environment(command: &mut Command, java: &Path) -> Result<(), String> {
    let java = java_environment_path(java);
    let bin = java.parent().ok_or("Java 路径无效")?;
    let home = bin.parent().ok_or("Java 安装目录无效")?;
    let mut paths = vec![bin.to_path_buf()];
    paths.extend(path_dirs());
    command
        .env("JAVA_HOME", home)
        .env(
            "PATH",
            std::env::join_paths(paths).map_err(|error| error.to_string())?,
        )
        .args([
            "-J-Dfile.encoding=UTF-8",
            "-J-Dstdout.encoding=UTF-8",
            "-J-Dstderr.encoding=UTF-8",
        ]);
    Ok(())
}

/// 让 JVM 在管道里也按 UTF-8 输出，中文才不会是乱码（Java 19 前后属性名不同）。
fn force_utf8_output(command: &mut Command) {
    command.args([
        "-Dfile.encoding=UTF-8",
        "-Dsun.stdout.encoding=UTF-8",
        "-Dsun.stderr.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-Dstderr.encoding=UTF-8",
    ]);
}

/// 编译缓存目录名：同一运行环境 + 同一文件/代码块复用，不同块互不干扰。
fn cache_key_for(prefix: &str, program: &Path, cache_key: Option<&str>) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!(
            "{prefix}:{}:{}",
            program.to_string_lossy(),
            cache_key.unwrap_or("file")
        ))
    )
}

/// 源码快照文件名：沿用原文件名（javac 要求 public 类名与文件名一致）。
/// 只有文件名确实属于这门语言、且是合法标识符时才沿用它，否则退回 Main
/// （Markdown 代码块的 file_path 是 .md 文件，不能拿来做类名）。
fn source_stem(request: &ScriptRequest, extension: &str) -> String {
    let file_path = request.file_path.as_deref();
    if !has_extension(file_path, extension) {
        return "Main".into();
    }
    file_path
        .map(Path::new)
        .and_then(Path::file_stem)
        .and_then(|stem| stem.to_str())
        .filter(|stem| is_identifier(stem))
        .unwrap_or("Main")
        .to_string()
}

fn is_identifier(word: &str) -> bool {
    word.chars()
        .next()
        .is_some_and(|first| first.is_alphabetic() || first == '_' || first == '$')
        && !is_java_keyword(word)
}

fn is_java_keyword(word: &str) -> bool {
    matches!(
        word,
        "abstract"
            | "assert"
            | "boolean"
            | "break"
            | "byte"
            | "case"
            | "catch"
            | "char"
            | "class"
            | "const"
            | "continue"
            | "default"
            | "do"
            | "double"
            | "else"
            | "enum"
            | "extends"
            | "final"
            | "finally"
            | "float"
            | "for"
            | "goto"
            | "if"
            | "implements"
            | "import"
            | "instanceof"
            | "int"
            | "interface"
            | "long"
            | "native"
            | "new"
            | "package"
            | "permits"
            | "private"
            | "protected"
            | "public"
            | "record"
            | "return"
            | "sealed"
            | "short"
            | "static"
            | "strictfp"
            | "super"
            | "switch"
            | "synchronized"
            | "this"
            | "throw"
            | "throws"
            | "transient"
            | "try"
            | "var"
            | "void"
            | "volatile"
            | "while"
            | "yield"
    )
}

/// 取出 Java 源码顶层（花括号深度 0）的单词，已剔除注释与字符串字面量。
fn top_level_words(source: &str) -> Vec<String> {
    fn flush(word: &mut String, depth: i32, words: &mut Vec<String>) {
        // 包名与限定名（com.example）里的点属于同一个单词，但结尾的
        // 点（import java.util.*）要丢掉。
        let trimmed = word.trim_end_matches('.');
        if depth == 0 && !trimmed.is_empty() {
            words.push(trimmed.to_string());
        }
        word.clear();
    }
    let mut words = Vec::new();
    let mut word = String::new();
    let mut depth = 0i32;
    let mut chars = source.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '/' if chars.peek() == Some(&'/') => {
                flush(&mut word, depth, &mut words);
                for next in chars.by_ref() {
                    if next == '\n' {
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                flush(&mut word, depth, &mut words);
                chars.next();
                while let Some(next) = chars.next() {
                    if next == '*' && chars.peek() == Some(&'/') {
                        chars.next();
                        break;
                    }
                }
            }
            '"' if chars.peek() == Some(&'"') => {
                flush(&mut word, depth, &mut words);
                chars.next();
                while let Some(next) = chars.next() {
                    if next == '"' && chars.peek() == Some(&'"') {
                        chars.next();
                        if chars.peek() == Some(&'"') {
                            chars.next();
                        }
                        break;
                    }
                }
            }
            '"' | '\'' => {
                flush(&mut word, depth, &mut words);
                while let Some(next) = chars.next() {
                    if next == '\\' {
                        chars.next();
                    } else if next == character {
                        break;
                    }
                }
            }
            '{' => {
                flush(&mut word, depth, &mut words);
                depth += 1;
            }
            '}' => {
                flush(&mut word, depth, &mut words);
                depth = (depth - 1).max(0);
            }
            // 点也算单词字符，这样 com.example、Foo.class 不会被拆开。
            _ if character.is_alphanumeric()
                || character == '_'
                || character == '$'
                || character == '.' =>
            {
                word.push(character);
            }
            _ => flush(&mut word, depth, &mut words),
        }
    }
    flush(&mut word, depth, &mut words);
    words
}

/// Java 主类：返回 (包名, 简单类名)，供 javac 文件名与 java 启动类使用。
fn java_main_class(source: &str) -> (Option<String>, Option<String>) {
    let words = top_level_words(source);
    let package = words
        .first()
        .filter(|word| word.as_str() == "package")
        .and_then(|_| words.get(1))
        .filter(|name| {
            name.chars().all(|character| {
                character.is_alphanumeric() || matches!(character, '.' | '_' | '$')
            })
        })
        .cloned();
    let mut fallback = None;
    for (index, word) in words.iter().enumerate() {
        if !matches!(word.as_str(), "class" | "interface" | "enum" | "record") {
            continue;
        }
        let Some(name) = words.get(index + 1).filter(|name| is_identifier(name)) else {
            continue;
        };
        let is_public = words[..index]
            .iter()
            .rev()
            .take(3)
            .any(|word| word == "public");
        if is_public {
            return (package, Some(name.clone()));
        }
        fallback.get_or_insert_with(|| name.clone());
    }
    (package, fallback)
}

/// classes 目录下主类对应的 .class 文件，用来判断编译缓存是否可用。
fn class_file(classes: &Path, main_class: &str) -> PathBuf {
    classes
        .join(main_class.replace('.', "/"))
        .with_extension("class")
}

struct PreparedRun {
    /// 需要先跑完的编译阶段；失败时不再进入运行阶段。
    compile: Option<Command>,
    command: Command,
    _snapshot: Option<NamedTempFile>,
    _project: TempDir,
    compiled_cache: Option<(PathBuf, String)>,
}

fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    if fs::read_to_string(path).ok().as_deref() != Some(content) {
        fs::write(path, content).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn prepare(request: &ScriptRequest, cache: &Path) -> Result<PreparedRun, String> {
    let (runtime, runtime_args) = find_runtime(&request.language, request.runtime_path.as_deref())?;
    fs::create_dir_all(cache).map_err(|error| error.to_string())?;
    let project = tempfile::Builder::new()
        .prefix("script-")
        .tempdir_in(cache)
        .map_err(|error| error.to_string())?;
    let cwd = request
        .file_path
        .as_ref()
        .map(PathBuf::from)
        .and_then(|path| {
            path.parent()
                .filter(|parent| parent.is_dir())
                .map(Path::to_path_buf)
        })
        .unwrap_or_else(|| project.path().to_path_buf());
    let extension = match request.language.as_str() {
        "javascript" => request
            .file_path
            .as_ref()
            .and_then(|path| Path::new(path).extension())
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .filter(|ext| matches!(ext.as_str(), "mjs" | "cjs"))
            .unwrap_or_else(|| "js".into()),
        "python" => "py".into(),
        "csharp" => "cs".into(),
        "java" => "java".into(),
        "rust" => "rs".into(),
        "kotlin" => {
            if has_extension(request.file_path.as_deref(), "kts") {
                "kts".into()
            } else {
                "kt".into()
            }
        }
        _ => return Err("不支持的脚本类型".into()),
    };
    // JS/Python snapshots stay beside the original so relative imports work.
    // The original document is never overwritten by F5. 需要编译的语言（C#/Java/Kotlin）
    // 把源码与编译产物留在自己的缓存目录里，便于复用。
    let snapshot = if matches!(request.language.as_str(), "csharp" | "java" | "kotlin") {
        None
    } else {
        let mut snapshot = tempfile::Builder::new()
            .prefix(".mde-run-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(&cwd)
            .map_err(|error| format!("无法创建运行快照：{error}"))?;
        snapshot
            .write_all(request.source.as_bytes())
            .map_err(|error| error.to_string())?;
        snapshot.flush().map_err(|error| error.to_string())?;
        Some(snapshot)
    };
    let mut compiled_cache = None;
    let mut compile = None;
    let mut cmd = command(runtime);
    cmd.args(runtime_args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match request.language.as_str() {
        "rust" => {
            let rustc = PathBuf::from(cmd.get_program());
            let directory = cache.join("rust").join(cache_key_for(
                "rust-v1",
                &rustc,
                request
                    .cache_key
                    .as_deref()
                    .or(request.file_path.as_deref()),
            ));
            fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            let source = directory.join("main.rs");
            let binary = directory.join(if cfg!(windows) { "run.exe" } else { "run" });
            let marker = directory.join("compiled-source.sha256");
            let digest = fingerprint(&request.source);
            // Recompile files with module/include dependencies; source-only caching would be stale.
            let cacheable = !request
                .source
                .split(|character: char| !character.is_alphanumeric() && character != '_')
                .any(|word| {
                    matches!(
                        word,
                        "mod"
                            | "include"
                            | "include_str"
                            | "include_bytes"
                            | "env"
                            | "option_env"
                            | "file"
                    )
                });
            let hit = cacheable
                && binary.is_file()
                && fs::read_to_string(&marker).ok().as_deref() == Some(&digest);
            write_if_changed(&source, &request.source)?;
            if !hit {
                let _ = fs::remove_file(&marker);
                let mut compiler = command(&rustc);
                #[cfg(windows)]
                crate::msvc::configure(&mut compiler)?;
                compiler
                    .args(["--edition=2021", "--crate-name", "mde_script"])
                    .arg(snapshot.as_ref().unwrap().path())
                    .arg("-o")
                    .arg(&binary)
                    .current_dir(&cwd)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                compile = Some(compiler);
            }
            cmd = command(&binary);
            cmd.current_dir(&cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            compiled_cache = Some((marker, digest));
        }
        "javascript" => {
            cmd.arg(snapshot.as_ref().unwrap().path());
        }
        "python" => {
            cmd.env("PYTHONIOENCODING", "utf-8")
                .env("PYTHONUTF8", "1")
                .arg("-u")
                .arg(snapshot.as_ref().unwrap().path());
        }
        "csharp" => {
            let sdk = dotnet_sdk(Path::new(cmd.get_program()))?;
            let framework = &sdk.framework;
            let runtime_key = format!(
                "{:x}",
                Sha256::digest(format!(
                    "{}:{framework}:{}:{}",
                    cmd.get_program().to_string_lossy(),
                    request.cache_key.as_deref().unwrap_or("file"),
                    sdk.roslyn
                        .as_ref()
                        .map(|compiler| compiler.identity.as_str())
                        .unwrap_or("msbuild")
                ))
            );
            let csharp_project = cache.join("csharp").join(runtime_key);
            fs::create_dir_all(&csharp_project).map_err(|error| error.to_string())?;
            let fingerprint = format!("{:x}", Sha256::digest(request.source.as_bytes()));
            let marker = csharp_project.join("compiled-source.sha256");
            let output = csharp_project.join("bin/Debug").join(&framework);
            let cache_hit = fs::read_to_string(&marker).ok().as_deref() == Some(&fingerprint)
                && ["Run.dll", "Run.deps.json", "Run.runtimeconfig.json"]
                    .iter()
                    .all(|name| output.join(name).is_file());
            // 源码指纹和三个产物同时有效才直接启动；修改或失败仍使缓存失效。
            if !cache_hit {
                let _ = fs::remove_file(&marker);
            }
            write_if_changed(&csharp_project.join("Program.cs"), &request.source)?;
            write_if_changed(&csharp_project.join("Run.csproj"), &format!(
                "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>{framework}</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><EnableDefaultCompileItems>false</EnableDefaultCompileItems><NuGetAudit>false</NuGetAudit><UseSharedCompilation>false</UseSharedCompilation></PropertyGroup><ItemGroup><Compile Include=\"Program.cs\" /></ItemGroup></Project>"
            ))?;
            write_if_changed(
                &csharp_project.join("NuGet.Config"),
                "<configuration><packageSources><clear /></packageSources></configuration>",
            )?;
            cmd.env("DOTNET_NOLOGO", "1")
                .env("Platform", "AnyCPU")
                .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
                .env("DOTNET_CLI_USE_MSBUILD_SERVER", "0")
                .env("MSBUILDDISABLENODEREUSE", "1")
                .env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1")
                .env("DOTNET_CLI_HOME", cache.join("dotnet-home"))
                .env("DOTNET_GENERATE_ASPNET_CERTIFICATE", "false")
                .env("DOTNET_ADD_GLOBAL_TOOLS_TO_PATH", "false")
                .env("NUGET_PACKAGES", cache.join("nuget"));
            if !cache_hit && sdk.roslyn.is_some() {
                let mut compiler = prepare_roslyn(
                    Path::new(cmd.get_program()),
                    sdk.roslyn.as_ref().unwrap(),
                    &csharp_project,
                    &output,
                    framework,
                    &cwd,
                )?;
                // 编译与运行共用稳定的 CLI_HOME，首跑不会碰用户目录或反复初始化 SDK。
                for (key, value) in cmd.get_envs() {
                    match value {
                        Some(value) => {
                            compiler.env(key, value);
                        }
                        None => {
                            compiler.env_remove(key);
                        }
                    }
                }
                compile = Some(compiler);
                cmd.arg(output.join("Run.dll"));
            } else if cache_hit {
                cmd.arg(output.join("Run.dll"));
            } else {
                // 非标准 SDK 缺少 Roslyn/reference pack 时保留原离线 MSBuild 回退。
                // 禁止服务复用的开关只作用于回退路径，避免产生用户未要求的常驻进程。
                cmd.args(["run", "--project"])
                    .arg(csharp_project.join("Run.csproj"))
                    .args([
                        "--no-launch-profile",
                        "--configuration",
                        "Debug",
                        "--verbosity",
                        "quiet",
                    ]);
            }
            compiled_cache = Some((marker, fingerprint));
        }
        // Java：javac 编译到缓存目录，再用 java 启动；源码未变时跳过编译。
        "java" => {
            // 运行环境可能填的是 javac，也可能直接填 JDK 目录：这里统一解析出这一对工具。
            let (java, javac) = java_toolchain(Path::new(cmd.get_program()))?;
            let mut launcher = command(&java);
            launcher
                .current_dir(&cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            force_utf8_output(&mut launcher);
            cmd = launcher;
            let project_dir =
                cache
                    .join("java")
                    .join(cache_key_for("java", &java, request.cache_key.as_deref()));
            let source_dir = project_dir.join("src");
            let classes_dir = project_dir.join("classes");
            for directory in [&source_dir, &classes_dir] {
                fs::create_dir_all(directory).map_err(|error| error.to_string())?;
            }
            let (package, detected) = java_main_class(&request.source);
            let class = detected.unwrap_or_else(|| source_stem(request, "java"));
            let qualified = match package.filter(|name| !name.is_empty()) {
                Some(package) => format!("{package}.{class}"),
                None => class.clone(),
            };
            // javac 要求 public 类名与文件名一致，所以按检测到的类名落盘。
            let source_file = source_dir.join(format!("{class}.java"));
            write_if_changed(&source_file, &request.source)?;
            let marker = project_dir.join("compiled-source.sha256");
            let digest = fingerprint(&request.source);
            let cache_hit = fs::read_to_string(&marker).ok().as_deref() == Some(&digest)
                && class_file(&classes_dir, &qualified).is_file();
            if !cache_hit {
                let _ = fs::remove_file(&marker);
                let mut compiler = command(&javac);
                compiler
                    .arg("-J-Dfile.encoding=UTF-8")
                    .args(["-encoding", "UTF-8", "-d"])
                    .arg(&classes_dir)
                    .arg(&source_file)
                    .current_dir(&cwd)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                compile = Some(compiler);
            }
            cmd.arg("-cp").arg(&classes_dir).arg(&qualified);
            compiled_cache = Some((marker, digest));
        }
        // Kotlin：缓存编译产物，二次运行只启动 JVM；脚本保留原 .kts 编译语义。
        "kotlin" => {
            // 运行环境应指向 kotlinc；填了 kotlin 运行器时换成同目录的编译器。
            let kotlinc = kotlin_compiler(Path::new(cmd.get_program()))?;
            let java = find_java(&kotlinc)?;
            let project_dir = cache.join("kotlin").join(cache_key_for(
                "kotlin",
                &PathBuf::from(format!("{}:{}", kotlinc.display(), java.display())),
                request.cache_key.as_deref(),
            ));
            fs::create_dir_all(&project_dir).map_err(|error| error.to_string())?;
            let is_kts = has_extension(request.file_path.as_deref(), "kts");
            let name = source_stem(request, if is_kts { "kts" } else { "kt" });
            let compiler_path = java_environment_path(&kotlinc);
            let script_runtime = compiler_path
                .parent()
                .and_then(Path::parent)
                .map(|home| home.join("lib/kotlin-script-runtime.jar"));
            if is_kts && script_runtime.as_ref().is_none_or(|path| !path.is_file()) {
                let script = project_dir.join(format!("{name}.kts"));
                write_if_changed(&script, &request.source)?;
                // 自定义编译器布局没有脚本运行库时，继续使用原解释路径保证兼容。
                let mut interpreter = command(&kotlinc);
                kotlin_java_environment(&mut interpreter, &java)?;
                interpreter
                    .arg("-script")
                    .arg(&script)
                    .current_dir(&cwd)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd = interpreter;
            } else {
                let source_file =
                    project_dir.join(format!("{name}.{}", if is_kts { "kts" } else { "kt" }));
                write_if_changed(&source_file, &request.source)?;
                let jar = project_dir.join("app.jar");
                let marker = project_dir.join("compiled-source.sha256");
                // 模式和快照名参与指纹，避免切换同文不同名脚本时复用错误的生成类。
                let digest = fingerprint(&format!(
                    "kotlin-cache-v3:{is_kts}:{name}:{}",
                    request.source
                ));
                let launcher_package = format!("mde.generated.kts._{}", &digest[..16]);
                let script_launcher = project_dir.join("MdeKtsLauncher.kt");
                if is_kts {
                    // 脚本仍由 Kotlin 按 .kts 编译，不能包进 main（会改变声明和 args 作用域）。
                    // 一次编译同时产出轻量启动器；命中 jar 后不再拉起整个 Kotlin 编译器。
                    write_if_changed(
                        &script_launcher,
                        &format!(
                            r#"package {launcher_package}
object MdeKtsLauncher {{
    @JvmStatic fun main(args: Array<String>) {{
        try {{
            // 使用编译器同样的 Java 字符分类，兼容中文、空格和标点文件名。
            val stem = args[0].replace(Regex("[^\\p{{L}}\\p{{Digit}}]"), "_")
            val name = if (Character.isJavaIdentifierStart(stem[0]))
                stem.take(1).uppercase(java.util.Locale.ROOT) + stem.drop(1) else "_" + stem
            // 从 jar 获取编译器生成的完整类名，包声明和反引号包名也无需改写源码。
            val loader = MdeKtsLauncher::class.java.classLoader
            val location = MdeKtsLauncher::class.java.protectionDomain.codeSource.location
            val script = java.util.jar.JarFile(java.io.File(location.toURI())).use {{ jar ->
                jar.entries().asSequence().filter {{ it.name.substringAfterLast('/') == name + ".class" }}
                    .map {{ Class.forName(it.name.removeSuffix(".class").replace('/', '.'), false, loader) }}
                    .first {{ it.superclass?.name == "kotlin.script.templates.standard.ScriptTemplateWithArgs" }}
            }}
            script.getConstructor(Array<String>::class.java).newInstance(emptyArray<String>())
        }} catch (error: java.lang.reflect.InvocationTargetException) {{
            val cause = error.targetException
            // 与 kotlinc -script 一样只显示用户脚本栈，不暴露启动器的反射栈。
            cause.stackTrace = cause.stackTrace.takeWhile {{
                !it.className.startsWith("jdk.internal.reflect.") &&
                !it.className.startsWith("sun.reflect.") &&
                it.className != "java.lang.reflect.Constructor" &&
                it.className != "{launcher_package}.MdeKtsLauncher"
            }}.toTypedArray()
            cause.printStackTrace()
            kotlin.system.exitProcess(1)
        }}
    }}
}}
"#
                        ),
                    )?;
                }
                let cache_hit =
                    fs::read_to_string(&marker).ok().as_deref() == Some(&digest) && jar.is_file();
                if !cache_hit {
                    let _ = fs::remove_file(&marker);
                    let mut compiler = command(&kotlinc);
                    kotlin_java_environment(&mut compiler, &java)?;
                    if is_kts {
                        compiler
                            .arg("-Xallow-any-scripts-in-source-roots")
                            .arg(&script_launcher);
                    }
                    compiler
                        .arg(&source_file)
                        .args(["-include-runtime", "-d"])
                        .arg(&jar)
                        .current_dir(&cwd)
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped());
                    compile = Some(compiler);
                }
                let mut launcher = command(&java);
                force_utf8_output(&mut launcher);
                if is_kts {
                    // 只需标准库和脚本运行库，不把编译器 jar 放进二次运行的 classpath。
                    let classpath = std::env::join_paths([jar.clone(), script_runtime.unwrap()])
                        .map_err(|error| error.to_string())?;
                    launcher
                        .arg("-cp")
                        .arg(classpath)
                        .arg(format!("{launcher_package}.MdeKtsLauncher"))
                        .arg(&name);
                } else {
                    launcher.arg("-jar").arg(&jar);
                }
                launcher
                    .current_dir(&cwd)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd = launcher;
                compiled_cache = Some((marker, digest));
            }
        }
        _ => unreachable!(),
    }
    Ok(PreparedRun {
        compile,
        command: cmd,
        _snapshot: snapshot,
        _project: project,
        compiled_cache,
    })
}

#[cfg(windows)]
pub(super) struct ProcessTree(isize);
#[cfg(windows)]
impl ProcessTree {
    pub(super) fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle() as isize) == 0
            {
                let error = std::io::Error::last_os_error().to_string();
                CloseHandle(job);
                return Err(error);
            }
            Ok(Self(job))
        }
    }
    pub(super) fn terminate(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(not(windows))]
pub(super) struct ProcessTree(u32);
#[cfg(not(windows))]
impl ProcessTree {
    pub(super) fn attach(child: &Child) -> Result<Self, String> {
        Ok(Self(child.id()))
    }
    pub(super) fn terminate(&self) {
        let _ = command("kill")
            .args(["-KILL", "--", &format!("-{}", self.0)])
            .status();
    }
}
#[cfg(not(windows))]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn event(request: &ScriptRequest, kind: &str, text: String) -> ScriptEvent {
    ScriptEvent {
        run_id: request.run_id.clone(),
        kind: kind.into(),
        text,
        exit_code: None,
        elapsed_ms: 0,
        cancelled: false,
    }
}

fn stream(
    mut reader: impl Read + Send + 'static,
    request: ScriptRequest,
    kind: &'static str,
    sink: Sink,
    budget: Arc<AtomicUsize>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut bytes = [0; 4096];
        let mut decoder = encoding_rs::UTF_8.new_decoder_without_bom_handling();
        while let Ok(count) = reader.read(&mut bytes) {
            let mut text = String::with_capacity(16384);
            let _ = decoder.decode_to_string(&bytes[..count], &mut text, count == 0);
            if !text.is_empty() {
                let previous = budget.fetch_add(text.len(), Ordering::Relaxed);
                if previous < 1024 * 1024 {
                    sink(event(&request, kind, text));
                }
                if previous < 1024 * 1024 && previous + count >= 1024 * 1024 {
                    sink(event(
                        &request,
                        "status",
                        "输出超过 1 MB，后续输出已截断。".into(),
                    ));
                }
            }
            if count == 0 {
                break;
            }
        }
    })
}

/// 启动一个阶段（编译或运行），转发输出并等待结束。
fn run_phase(
    command: &mut Command,
    capture_input: bool,
    request: &ScriptRequest,
    control: &RunControl,
    sink: Sink,
) -> Result<Option<i32>, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动运行环境：{error}"))?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    if capture_input {
        *control.input.lock().unwrap() = child.stdin.take();
    }
    let budget = Arc::new(AtomicUsize::new(0));
    let stdout = stream(
        child.stdout.take().unwrap(),
        request.clone(),
        "stdout",
        sink.clone(),
        budget.clone(),
    );
    let stderr = stream(
        child.stderr.take().unwrap(),
        request.clone(),
        "stderr",
        sink,
        budget,
    );
    let result = loop {
        if control.cancelled.load(Ordering::SeqCst) {
            tree.terminate();
            let _ = child.kill();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code()),
            Ok(None) => thread::sleep(Duration::from_millis(30)),
            Err(error) => {
                tree.terminate();
                let _ = child.kill();
                let _ = child.wait();
                break Err(error.to_string());
            }
        }
    };
    if capture_input {
        control.input.lock().unwrap().take();
    }
    // Close descendants before joining readers, including children holding pipe handles.
    drop(tree);
    let _ = stdout.join();
    let _ = stderr.join();
    result
}

fn execute(
    request: &ScriptRequest,
    cache: &Path,
    control: &RunControl,
    sink: Sink,
) -> Result<Option<i32>, String> {
    let mut prepared = prepare(request, cache)?;
    if control.cancelled.load(Ordering::SeqCst) {
        return Ok(None);
    }
    // Java/Kotlin 先编译：编译器输出直接进控制台，失败就停在编译阶段。
    if let Some(mut compiler) = prepared.compile.take() {
        match run_phase(&mut compiler, false, request, control, sink.clone())? {
            Some(0) => {}
            code => return Ok(code),
        }
        if control.cancelled.load(Ordering::SeqCst) {
            return Ok(None);
        }
    }
    sink(event(request, "status", "started".into()));
    let result = run_phase(&mut prepared.command, true, request, control, sink);
    if matches!(result, Ok(Some(0))) && !control.cancelled.load(Ordering::SeqCst) {
        if let Some((marker, fingerprint)) = &prepared.compiled_cache {
            let _ = fs::write(marker, fingerprint);
        }
    }
    result
}

#[tauri::command]
pub fn start_script(app: AppHandle, request: ScriptRequest) -> Result<(), String> {
    if cfg!(target_os = "android") {
        return Err("脚本运行仅桌面版可用。".into());
    }
    if request.run_id.is_empty()
        || request.run_id.len() > 80
        || !request
            .run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || !["javascript", "python", "csharp", "java", "kotlin", "rust"]
            .contains(&request.language.as_str())
    {
        return Err("无效的运行请求".into());
    }
    if request.source.len() > 10 * 1024 * 1024 {
        return Err("脚本超过 10 MB。".into());
    }
    if request
        .cache_key
        .as_ref()
        .is_some_and(|key| key.len() > 32768)
    {
        return Err("无效的代码块标识".into());
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("script-runs");
    let control = Arc::new(RunControl::default());
    {
        let mut runs = RUNS.lock().unwrap();
        if runs.len() >= 8 || runs.contains_key(&request.run_id) {
            return Err("最多同时运行 8 个脚本，请先停止一个运行。".into());
        }
        runs.insert(request.run_id.clone(), control.clone());
    }
    thread::spawn(move || {
        let started = Instant::now();
        let sink: Sink = Arc::new(move |event| {
            let _ = app.emit("script-output", event);
        });
        let result = execute(&request, &cache, &control, sink.clone());
        if let Err(error) = &result {
            sink(event(&request, "stderr", format!("{error}\n")));
        }
        let mut finished = event(&request, "exit", String::new());
        finished.exit_code = result.ok().flatten();
        finished.cancelled = control.cancelled.load(Ordering::SeqCst);
        finished.elapsed_ms = started.elapsed().as_millis();
        RUNS.lock().unwrap().remove(&request.run_id);
        sink(finished);
    });
    Ok(())
}

#[tauri::command]
pub fn stop_script(run_id: String) -> bool {
    if let Some(control) = RUNS.lock().unwrap().get(&run_id) {
        control.cancelled.store(true, Ordering::SeqCst);
        return true;
    }
    false
}

#[tauri::command]
pub async fn write_script_input(run_id: String, text: String) -> Result<(), String> {
    if text.len() > 8192 {
        return Err("单次输入不能超过 8 KB。".into());
    }
    let control = RUNS
        .lock()
        .unwrap()
        .get(&run_id)
        .cloned()
        .ok_or("运行已结束")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut input = control.input.lock().unwrap();
        let input = input.as_mut().ok_or("程序尚未开始或输入已关闭")?;
        writeln!(input, "{text}")
            .and_then(|_| input.flush())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn stop_all() {
    for control in RUNS.lock().unwrap().values() {
        control.cancelled.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_rust_commands_without_overwriting_source() {
        let root = tempfile::tempdir().unwrap();
        let compiler = root
            .path()
            .join(if cfg!(windows) { "rustc.exe" } else { "rustc" });
        fs::write(&compiler, "fake compiler").unwrap();
        let original = root.path().join("original.rs");
        fs::write(&original, "saved source").unwrap();
        let mut req = request("rust", "fn main() { println!(\"42\"); }");
        req.runtime_path = Some(compiler.to_string_lossy().into_owned());
        req.file_path = Some(original.to_string_lossy().into_owned());
        let cache = root.path().join("cache");
        let prepared = prepare(&req, &cache).unwrap();
        let compilation = prepared.compile.as_ref().unwrap();
        assert_eq!(compilation.get_program(), compiler.as_os_str());
        assert!(args_of(compilation).contains(&"--edition=2021".into()));
        assert_eq!(prepared.command.get_current_dir(), Some(root.path()));
        assert_eq!(fs::read_to_string(&original).unwrap(), "saved source");
        let (marker, digest) = prepared.compiled_cache.as_ref().unwrap();
        fs::write(marker, digest).unwrap();
        fs::write(prepared.command.get_program(), "compiled binary").unwrap();
        assert!(prepare(&req, &cache).unwrap().compile.is_none());
        req.source = "invalid rust".into();
        assert!(prepare(&req, &cache).unwrap().compile.is_some());
    }

    #[test]
    #[ignore = "requires locally installed rustc and a native linker"]
    fn rust_outputs_unicode_and_compile_errors() {
        let (code, stdout, stderr) = run("rust", "fn main() { println!(\"Rust 中文 🦀 42\"); }");
        assert_eq!(code, Some(0), "{stderr}");
        assert!(stdout.contains("Rust 中文 🦀 42"));
        let (code, stdout, stderr) = run("rust", "fn main() { does_not_exist(); }");
        assert_ne!(code, Some(0));
        assert!(stdout.is_empty());
        assert!(stderr.contains("does_not_exist"));
    }

    #[test]
    #[ignore = "requires locally installed rustc and a native linker"]
    fn rust_relative_modules_use_unsaved_snapshot_and_stdin() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("main.rs");
        fs::write(&original, "original").unwrap();
        fs::write(
            root.path().join("helper.rs"),
            "pub fn value() -> u32 { 42 }",
        )
        .unwrap();
        let mut req = request("rust", "mod helper; fn main() { let mut input = String::new(); std::io::stdin().read_line(&mut input).unwrap(); println!(\"{} {}\", helper::value(), input.trim()); }");
        req.file_path = Some(original.to_string_lossy().into_owned());
        let prepared = prepare(&req, &root.path().join("cache")).unwrap();
        let output = prepared.compile.unwrap().output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let mut child = prepared.command;
        let mut child = child.spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all("输入🦀\n".as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).contains("42 输入🦀"));
        assert_eq!(fs::read_to_string(&original).unwrap(), "original");
    }
    fn request(language: &str, source: &str) -> ScriptRequest {
        ScriptRequest {
            run_id: "test".into(),
            language: language.into(),
            source: source.into(),
            file_path: None,
            runtime_path: None,
            cache_key: None,
        }
    }
    // 计时覆盖与 F5 相同的准备、编译、输出转发和进程树回收；只在 release 手动运行。
    #[test]
    #[ignore = "release performance benchmark; requires all local runtimes"]
    fn release_f5_timings() {
        assert!(!cfg!(debug_assertions), "请使用 cargo test --release");
        let cases = [
            ("C#", "csharp", "cs", "Console.WriteLine(42);", "Console.WriteLine(43);"),
            ("Java", "java", "java", "public class Main { public static void main(String[] a) { System.out.println(42); } }", "public class Main { public static void main(String[] a) { System.out.println(43); } }"),
            ("Kotlin.kt", "kotlin", "kt", "fun main() { println(42) }", "fun main() { println(43) }"),
            ("Kotlin.kts", "kotlin", "kts", "println(42)", "println(43)"),
        ];
        let mut rows = Vec::new();
        for (label, language, extension, source, changed) in cases {
            let root = tempfile::tempdir().unwrap();
            let cache = root.path().join("cache");
            let mut req = request(language, source);
            req.file_path = Some(
                root.path()
                    .join(format!("Main.{extension}"))
                    .to_string_lossy()
                    .into(),
            );
            let timed = |req: &ScriptRequest| {
                let output = Arc::new(Mutex::new(String::new()));
                let copy = output.clone();
                let start = Instant::now();
                let code = execute(
                    req,
                    &cache,
                    &RunControl::default(),
                    Arc::new(move |event| {
                        if event.kind == "stdout" || event.kind == "stderr" {
                            copy.lock().unwrap().push_str(&event.text);
                        }
                    }),
                )
                .unwrap();
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(code, Some(0), "{}", output.lock().unwrap());
                // 计时结束后同时核验真实产物和缓存，不能把早退或复用旧产物误报成提速。
                let completed = prepare(req, &cache).unwrap();
                assert!(completed.compile.is_none(), "成功运行后应能复用编译产物");
                let (marker, digest) = completed.compiled_cache.as_ref().unwrap();
                assert_eq!(fs::read_to_string(marker).unwrap(), *digest);
                let artifact = match language {
                    "csharp" => PathBuf::from(completed.command.get_args().last().unwrap()),
                    "java" => class_file(&marker.parent().unwrap().join("classes"), "Main"),
                    "kotlin" => marker.parent().unwrap().join("app.jar"),
                    _ => unreachable!(),
                };
                assert!(fs::metadata(&artifact).unwrap().len() > 0, "{artifact:?}");
                if language == "csharp" {
                    for extension in ["deps.json", "runtimeconfig.json"] {
                        assert!(
                            fs::metadata(artifact.with_extension(extension))
                                .unwrap()
                                .len()
                                > 0
                        );
                    }
                }
                assert!(output.lock().unwrap().contains(if req.source == source {
                    "42"
                } else {
                    "43"
                }));
                elapsed
            };
            assert!(!cache.exists(), "冷编译必须使用全新空缓存");
            let cold = timed(&req);
            let warm = (0..5).map(|_| timed(&req)).collect::<Vec<_>>();
            req.source = changed.into();
            let edit = timed(&req);
            let row = serde_json::json!({"language": label, "coldMs": cold, "warmMs": warm, "oneCharacterEditMs": edit, "validation": {"exitCode": 0, "artifactNonempty": true, "outputChecked": true, "coldCacheEmpty": true}});
            eprintln!("F5_PERF {row}");
            rows.push(row);
        }
        if let Some(path) = std::env::var_os("MDE_F5_BENCH_REPORT") {
            fs::write(path, serde_json::to_string_pretty(&rows).unwrap()).unwrap();
        }
    }
    fn run(language: &str, source: &str) -> (Option<i32>, String, String) {
        let cache = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_copy = events.clone();
        let sink: Sink = Arc::new(move |event| events_copy.lock().unwrap().push(event));
        let result = execute(
            &request(language, source),
            cache.path(),
            &RunControl::default(),
            sink,
        )
        .unwrap();
        let events = events.lock().unwrap();
        let output = |kind: &str| {
            events
                .iter()
                .filter(|event| event.kind == kind)
                .map(|event| event.text.as_str())
                .collect::<String>()
        };
        (result, output("stdout"), output("stderr"))
    }
    #[test]
    #[ignore = "requires locally installed Node.js"]
    fn javascript_outputs_unicode_and_errors() {
        let (code, stdout, stderr) = run(
            "javascript",
            "console.log('中文'); console.error('error'); process.exitCode = 3;",
        );
        assert_eq!(code, Some(3));
        assert!(stdout.contains("中文"));
        assert!(stderr.contains("error"));
    }
    #[test]
    #[ignore = "requires locally installed Python"]
    fn python_runs_unbuffered() {
        let (code, stdout, _) = run("python", "print('Python 中文')");
        assert_eq!(code, Some(0));
        assert!(stdout.contains("Python 中文"));
    }
    #[test]
    #[ignore = "requires locally installed .NET SDK"]
    fn csharp_supports_top_level_statements() {
        let (code, stdout, stderr) = run(
            "csharp",
            "Console.WriteLine(2 + 3); Console.WriteLine(\"C# 中文\");",
        );
        assert_eq!(code, Some(0), "{stderr}");
        assert!(stdout.contains('5'));
        assert!(stdout.contains("C# 中文"));
    }
    #[test]
    #[ignore = "requires locally installed .NET SDK"]
    fn simultaneous_csharp_blocks_use_independent_projects() {
        let cache = tempfile::tempdir().unwrap();
        let runs = (0..2)
            .map(|index| {
                let mut request =
                    request("csharp", &format!("Console.WriteLine(\"block-{index}\");"));
                request.cache_key = Some(format!("markdown-block-{index}"));
                let cache = cache.path().to_owned();
                thread::spawn(move || {
                    let output = Arc::new(Mutex::new(String::new()));
                    let copy = output.clone();
                    let result = execute(
                        &request,
                        &cache,
                        &RunControl::default(),
                        Arc::new(move |event| {
                            if event.kind == "stdout" || event.kind == "stderr" {
                                copy.lock().unwrap().push_str(&event.text);
                            }
                        }),
                    )
                    .unwrap();
                    let text = output.lock().unwrap().clone();
                    (index, result, text)
                })
            })
            .collect::<Vec<_>>();
        for run in runs {
            let (index, code, text) = run.join().unwrap();
            assert_eq!(code, Some(0), "{text}");
            assert!(text.contains(&format!("block-{index}")));
            assert!(!text.contains(&format!("block-{}", 1 - index)));
        }
        assert_eq!(
            fs::read_dir(cache.path().join("csharp")).unwrap().count(),
            2
        );
    }
    #[test]
    #[ignore = "requires locally installed .NET SDK"]
    fn csharp_reuses_successful_build_and_invalidates_changed_or_failed_source() {
        let cache = tempfile::tempdir().unwrap();
        let run_cached = |source: &str| {
            let output = Arc::new(Mutex::new(String::new()));
            let copy = output.clone();
            let sink: Sink = Arc::new(move |event| {
                if event.kind == "stdout" || event.kind == "stderr" {
                    copy.lock().unwrap().push_str(&event.text);
                }
            });
            let started = Instant::now();
            let result = execute(
                &request("csharp", source),
                cache.path(),
                &RunControl::default(),
                sink,
            )
            .unwrap();
            let text = output.lock().unwrap().clone();
            (result, text, started.elapsed())
        };
        let first = run_cached("Console.WriteLine(42);");
        assert_eq!(first.0, Some(0), "{}", first.1);
        let unchanged =
            prepare(&request("csharp", "Console.WriteLine(42);"), cache.path()).unwrap();
        assert!(unchanged
            .command
            .get_args()
            .next()
            .unwrap()
            .to_string_lossy()
            .ends_with("Run.dll"));
        let warm = run_cached("Console.WriteLine(42);");
        assert_eq!(warm.0, Some(0));
        assert!(warm.1.contains("42"));
        eprintln!("C# first run: {:?}; cached run: {:?}", first.2, warm.2);
        let changed = run_cached("Console.WriteLine(84);");
        assert_eq!(changed.0, Some(0), "{}", changed.1);
        assert!(changed.1.contains("84"));
        assert!(!changed.1.contains("42"));
        let failed = run_cached("this is not valid C#;");
        assert_ne!(failed.0, Some(0));
        let failed_again =
            prepare(&request("csharp", "this is not valid C#;"), cache.path()).unwrap();
        // 失败源码必须重编；标准 SDK 走 Roslyn 阶段，其余环境仍走 MSBuild。
        assert!(
            failed_again.compile.is_some()
                || failed_again.command.get_args().next().unwrap() == "run"
        );
        let restored = run_cached("Console.WriteLine(42);");
        assert_eq!(restored.0, Some(0), "{}", restored.1);
        assert!(restored.1.contains("42"));
    }
    #[test]
    #[ignore = "requires locally installed Node.js"]
    fn cancellation_stops_an_infinite_script() {
        let cache = tempfile::tempdir().unwrap();
        let control = Arc::new(RunControl::default());
        let copy = control.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.text == "started" {
                copy.cancelled.store(true, Ordering::SeqCst);
            }
        });
        let started = Instant::now();
        execute(
            &request("javascript", "setInterval(() => {}, 1000)"),
            cache.path(),
            &control,
            sink,
        )
        .unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
    }
    #[test]
    #[ignore = "requires locally installed Python"]
    fn stdin_prompts_stream_without_a_newline() {
        let cache = tempfile::tempdir().unwrap();
        let control = Arc::new(RunControl::default());
        let copy = control.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.kind == "stdout" && event.text.contains("Name?") {
                let mut input = copy.input.lock().unwrap();
                writeln!(input.as_mut().unwrap(), "中文").unwrap();
            }
        });
        assert_eq!(
            execute(
                &request("python", "name = input('Name?'); print(name)"),
                cache.path(),
                &control,
                sink
            )
            .unwrap(),
            Some(0)
        );
    }
    #[test]
    fn rejects_invalid_runtime_paths() {
        assert!(find_runtime("python", Some("relative/python.exe")).is_err());
        assert!(find_runtime("ruby", None).is_err());
    }
    #[test]
    fn environment_homes_precede_path_and_invalid_homes_fall_back() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("preferred jdk");
        let path = root.path().join("path jdk");
        for directory in [home.join("bin"), path.clone()] {
            fs::create_dir_all(&directory).unwrap();
            for name in ["java", "javac"] {
                fs::write(launcher_names(&directory, name).remove(0), b"stub").unwrap();
            }
        }
        let selected = environment_runtime(&["java"], &[home.clone()], &[path.clone()]).unwrap();
        assert_eq!(selected.0.parent().unwrap(), home.join("bin"));
        let missing = root.path().join("missing");
        let selected = environment_runtime(&["java"], &[missing], &[path.clone()]).unwrap();
        assert_eq!(selected.0.parent().unwrap(), path);
        // A JRE without javac must not mask a usable JDK farther along PATH.
        fs::remove_file(launcher_names(&home.join("bin"), "javac").remove(0)).unwrap();
        let selected = environment_runtime(&["java"], &[home], &[path.clone()]).unwrap();
        assert_eq!(selected.0.parent().unwrap(), path);
    }
    #[test]
    fn kotlin_home_precedes_path() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("kotlin home");
        let path = root.path().join("path kotlin");
        for directory in [home.join("bin"), path.clone()] {
            fs::create_dir_all(&directory).unwrap();
            fs::write(launcher_names(&directory, "kotlinc").remove(0), b"stub").unwrap();
        }
        let selected = environment_runtime(&["kotlinc"], &[home.clone()], &[path.clone()]).unwrap();
        assert_eq!(selected.0.parent().unwrap(), home.join("bin"));
        let selected = environment_runtime(&["kotlinc"], &[], &[path.clone()]).unwrap();
        assert_eq!(selected.0.parent().unwrap(), path);
    }
    #[cfg(windows)]
    #[test]
    fn system_scan_finds_portable_jdk_and_kotlin_installations() {
        let root = tempfile::tempdir().unwrap();
        for version in ["jdk-8", "jdk-21", "jdk-25"] {
            let bin = root.path().join("jdk").join(version).join("bin");
            fs::create_dir_all(&bin).unwrap();
            fs::write(bin.join("java.exe"), b"stub").unwrap();
            fs::write(bin.join("javac.exe"), b"stub").unwrap();
        }
        let bin = root.path().join("kotlinc").join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("kotlinc.bat"), b"stub").unwrap();
        let mut candidates = vec![];
        scan_jdk_roots(&[root.path().to_path_buf()], &mut candidates);
        assert_eq!(
            candidates.iter().find(|path| executable(path)).unwrap(),
            &root.path().join("jdk/jdk-25/bin/java.exe")
        );
        candidates.clear();
        scan_kotlin_roots(&[root.path().to_path_buf()], &mut candidates);
        assert!(candidates.iter().any(|path| executable(path)));
        candidates.clear();
        scan_versioned(
            &[root.path().join("kotlinc")],
            "bin/kotlinc.bat",
            &mut candidates,
        );
        assert_eq!(
            candidates.iter().find(|path| executable(path)).unwrap(),
            &bin.join("kotlinc.bat")
        );
    }
    #[test]
    #[ignore = "requires locally installed Python"]
    fn snapshots_preserve_the_original_and_relative_imports() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("original.py");
        fs::write(&file, "original unsaved baseline").unwrap();
        fs::write(
            root.path().join("helper.py"),
            "value = 'relative import works'",
        )
        .unwrap();
        let mut request = request("python", "from helper import value\nprint(value)");
        request.file_path = Some(file.to_string_lossy().into());
        let output = Arc::new(Mutex::new(String::new()));
        let copy = output.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.kind == "stdout" {
                copy.lock().unwrap().push_str(&event.text);
            }
        });
        let cache = tempfile::tempdir().unwrap();
        assert_eq!(
            execute(&request, cache.path(), &RunControl::default(), sink).unwrap(),
            Some(0)
        );
        assert!(output.lock().unwrap().contains("relative import works"));
        assert_eq!(
            fs::read_to_string(file).unwrap(),
            "original unsaved baseline"
        );
        assert!(!fs::read_dir(root.path())
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with(".mde-run-")));
    }
    #[test]
    #[ignore = "requires locally installed Node.js"]
    fn descendants_cannot_keep_output_pipes_open_after_exit() {
        let started = Instant::now();
        let (code, _, _) = run("javascript", "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'}); setTimeout(() => process.exit(0), 100);");
        assert_eq!(code, Some(0));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }
    #[test]
    fn detects_java_main_class_and_package() {
        assert_eq!(
            java_main_class("public class Main { public static void main(String[] args) {} }"),
            (None, Some("Main".into()))
        );
        assert_eq!(
            java_main_class("package com.example;\npublic class App {}"),
            (Some("com.example".into()), Some("App".into()))
        );
        // public 类不在最前面时也以它为主类。
        assert_eq!(
            java_main_class("class Helper {}\npublic final class Runner {}"),
            (None, Some("Runner".into()))
        );
        assert_eq!(
            java_main_class("public record Point(int x, int y) {}"),
            (None, Some("Point".into()))
        );
        // 注释、字符串与嵌套类都不算主类。
        assert_eq!(
            java_main_class("// public class Fake\nclass Outer { static class Inner {} }"),
            (None, Some("Outer".into()))
        );
        assert_eq!(
            java_main_class("class Only {}\nString note = \"public class Fake {}\";"),
            (None, Some("Only".into()))
        );
        // 注解里的 Foo.class 不能被当成主类。
        assert_eq!(
            java_main_class("@RunWith(Foo.class)\npublic class Spec {}"),
            (None, Some("Spec".into()))
        );
        assert_eq!(
            java_main_class("@RunWith(Foo.class)\nclass Spec {}"),
            (None, Some("Spec".into()))
        );
        // 中文类名同样是合法标识符。
        assert_eq!(
            java_main_class("public class 中文类 {}"),
            (None, Some("中文类".into()))
        );
    }
    #[test]
    fn builds_java_compile_and_run_commands() {
        let cache = tempfile::tempdir().unwrap();
        let exe = if cfg!(windows) { ".exe" } else { "" };
        let java = cache.path().join(format!("java{exe}"));
        let javac = cache.path().join(format!("javac{exe}"));
        fs::write(&java, b"stub").unwrap();
        fs::write(&javac, b"stub").unwrap();
        let mut request = request(
            "java",
            "public class Main { public static void main(String[] a) {} }",
        );
        request.runtime_path = Some(java.to_string_lossy().into());
        let prepared = prepare(&request, cache.path()).unwrap();
        let compiler = prepared.compile.as_ref().expect("Java 需要先编译");
        assert_eq!(compiler.get_program(), javac.as_os_str());
        let compile_args = args_of(compiler);
        assert!(compile_args.iter().any(|arg| arg.ends_with("Main.java")));
        assert!(compile_args.contains(&"-encoding".to_string()));
        let run_args = args_of(&prepared.command);
        assert!(run_args.contains(&"-cp".to_string()));
        assert_eq!(run_args.last().unwrap(), "Main");
        // 管道里也要按 UTF-8 输出，中文才不会是乱码。
        assert!(run_args.contains(&"-Dfile.encoding=UTF-8".to_string()));
        // 指纹与 .class 都在时跳过编译，与 C# 的成功缓存一致。
        let project = cache
            .path()
            .join("java")
            .join(cache_key_for("java", &java, None));
        fs::write(
            project.join("compiled-source.sha256"),
            fingerprint(&request.source),
        )
        .unwrap();
        fs::write(project.join("classes").join("Main.class"), b"stub").unwrap();
        assert!(prepare(&request, cache.path()).unwrap().compile.is_none());
    }
    #[test]
    fn accepts_javac_or_a_jdk_directory_as_the_java_runtime() {
        let cache = tempfile::tempdir().unwrap();
        let exe = if cfg!(windows) { ".exe" } else { "" };
        let jdk = cache.path().join("jdk-21");
        let bin = jdk.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let java = bin.join(format!("java{exe}"));
        let javac = bin.join(format!("javac{exe}"));
        fs::write(&java, b"stub").unwrap();
        fs::write(&javac, b"stub").unwrap();
        let source = "public class Main { public static void main(String[] a) {} }";
        // 填 javac（用户容易这么填）：编译用它，运行改用同目录的 java，
        // 不能把 -Dfile.encoding 之类的 JVM 参数丢给 javac。
        let mut javac_request = request("java", source);
        javac_request.runtime_path = Some(javac.to_string_lossy().into());
        let from_javac = prepare(&javac_request, cache.path()).unwrap();
        assert_eq!(from_javac.command.get_program(), java.as_os_str());
        assert_eq!(
            from_javac.compile.as_ref().unwrap().get_program(),
            javac.as_os_str()
        );
        // 直接填 JDK 目录同样可用。
        let mut directory_request = request("java", source);
        directory_request.runtime_path = Some(jdk.to_string_lossy().into());
        let from_directory = prepare(&directory_request, cache.path()).unwrap();
        assert_eq!(from_directory.command.get_program(), java.as_os_str());
        // 两种填法归一化到同一个编译缓存目录。
        let (marker, _) = from_directory.compiled_cache.unwrap();
        assert!(marker.starts_with(
            cache
                .path()
                .join("java")
                .join(cache_key_for("java", &java, None))
        ));
    }
    #[test]
    #[ignore = "requires locally installed JDK"]
    fn java_runs_a_source_file_with_utf8_output() {
        let (code, stdout, stderr) = run(
            "java",
            "public class Main { public static void main(String[] args) { System.out.println(\"Java 中文\"); } }",
        );
        assert_eq!(code, Some(0), "{stderr}");
        assert!(stdout.contains("Java 中文"), "{stdout}");
    }
    #[test]
    #[ignore = "requires locally installed JDK"]
    fn java_runs_when_the_runtime_points_at_javac() {
        // 用户容易把“运行环境”填成 javac：运行阶段必须自动改用同目录的 java。
        let (java, _) = find_runtime("java", None).expect("本机需要 JDK");
        let javac = javac_for(&java).expect("本机需要 JDK 的 javac");
        let cache = tempfile::tempdir().unwrap();
        let mut request = request(
            "java",
            "public class Main { public static void main(String[] a) { System.out.println(\"中文 ok\"); } }",
        );
        request.runtime_path = Some(javac.to_string_lossy().into());
        let output = Arc::new(Mutex::new(String::new()));
        let copy = output.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.kind == "stdout" || event.kind == "stderr" {
                copy.lock().unwrap().push_str(&event.text);
            }
        });
        assert_eq!(
            execute(&request, cache.path(), &RunControl::default(), sink).unwrap(),
            Some(0)
        );
        assert!(output.lock().unwrap().contains("中文 ok"));
    }
    #[test]
    #[ignore = "requires locally installed Kotlin compiler"]
    fn kotlin_runs_a_main_function() {
        let (code, stdout, stderr) = run("kotlin", "fun main() { println(\"Kotlin 中文\") }");
        assert_eq!(code, Some(0), "stdout: {stdout}\nstderr: {stderr}");
        assert!(stdout.contains("Kotlin 中文"), "{stdout}");
    }
    #[test]
    fn builds_kotlin_compile_and_run_commands() {
        let cache = tempfile::tempdir().unwrap();
        let exe = if cfg!(windows) { ".exe" } else { "" };
        let bat = if cfg!(windows) { ".bat" } else { "" };
        let kotlinc = cache.path().join(format!("kotlinc{bat}"));
        let java = cache.path().join(format!("java{exe}"));
        fs::write(&kotlinc, b"stub").unwrap();
        fs::write(&java, b"stub").unwrap();
        let mut request = request("kotlin", "fun main() { println(42) }");
        request.runtime_path = Some(kotlinc.to_string_lossy().into());
        let prepared = prepare(&request, cache.path()).unwrap();
        let compiler = prepared.compile.as_ref().expect("Kotlin 需要先编译");
        assert_eq!(compiler.get_program(), kotlinc.as_os_str());
        let compile_args = args_of(compiler);
        assert!(compile_args.contains(&"-include-runtime".to_string()));
        assert!(compile_args.iter().any(|arg| arg.ends_with("app.jar")));
        // Compiler and launcher share the selected Java, even when discovery found it outside PATH.
        let selected = find_java(&kotlinc).unwrap();
        assert_eq!(prepared.command.get_program(), selected.as_os_str());
        let selected = java_environment_path(&selected);
        #[cfg(windows)]
        assert!(!selected.to_string_lossy().starts_with(r"\\?\"));
        let expected_home = selected.parent().unwrap().parent().unwrap();
        assert!(compiler
            .get_envs()
            .any(|(key, value)| key == "JAVA_HOME" && value == Some(expected_home.as_os_str())));
        assert!(compile_args.contains(&"-J-Dfile.encoding=UTF-8".to_string()));
        let run_args = args_of(&prepared.command);
        // JVM 的 UTF-8 属性必须排在 -jar 之前，否则会被当成程序参数。
        let jar_index = run_args.iter().position(|arg| arg == "-jar").unwrap();
        assert!(jar_index > 0);
        assert!(run_args[..jar_index]
            .iter()
            .any(|arg| arg == "-Dfile.encoding=UTF-8"));
        assert!(run_args[jar_index + 1].ends_with("app.jar"));
        assert!(run_args.iter().any(|arg| arg.ends_with("app.jar")));
    }
    #[test]
    fn kotlin_scripts_run_without_a_compile_step() {
        let cache = tempfile::tempdir().unwrap();
        let bat = if cfg!(windows) { ".bat" } else { "" };
        let kotlinc = cache.path().join(format!("kotlinc{bat}"));
        fs::write(&kotlinc, b"stub").unwrap();
        fs::write(launcher_names(cache.path(), "java").remove(0), b"stub").unwrap();
        let script = cache.path().join("demo.kts");
        let mut request = request("kotlin", "println(42)");
        request.runtime_path = Some(kotlinc.to_string_lossy().into());
        request.file_path = Some(script.to_string_lossy().into());
        let prepared = prepare(&request, cache.path()).unwrap();
        assert!(prepared.compile.is_none());
        assert!(prepared.compiled_cache.is_none());
        let run_args = args_of(&prepared.command);
        let script_index = run_args.iter().position(|arg| arg == "-script").unwrap();
        assert!(run_args[script_index + 1].ends_with("demo.kts"));
        assert!(prepared
            .command
            .get_envs()
            .any(|(key, value)| key == "JAVA_HOME" && value.is_some()));
    }
    #[test]
    #[ignore = "requires locally installed Kotlin compiler and JDK"]
    fn kotlin_script_supports_utf8_and_stdin() {
        let cache = tempfile::tempdir().unwrap();
        let mut request = request(
            "kotlin",
            "print(\"Name?\"); val name = readln(); println(\"你好 $name\")",
        );
        request.file_path = Some(cache.path().join("中文 demo.kts").to_string_lossy().into());
        let control = Arc::new(RunControl::default());
        let copy = control.clone();
        let output = Arc::new(Mutex::new(String::new()));
        let captured = output.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.kind == "stdout" || event.kind == "stderr" {
                captured.lock().unwrap().push_str(&event.text);
                if event.text.contains("Name?") {
                    writeln!(copy.input.lock().unwrap().as_mut().unwrap(), "中文").unwrap();
                }
            }
        });
        let result = execute(&request, cache.path(), &control, sink).unwrap();
        assert_eq!(result, Some(0), "{}", output.lock().unwrap());
        assert!(output.lock().unwrap().contains("你好 中文"));
    }
    #[test]
    #[ignore = "requires locally installed .NET SDK"]
    fn roslyn_preserves_console_project_defaults_and_utf8_input() {
        let source = r#"
#if DEBUG && TRACE && NET && NETCOREAPP && NET6_0_OR_GREATER
Console.Write("Name?");
var value = Console.ReadLine();
Console.WriteLine($"你好 {value} {Enumerable.Range(1, 3).Sum()}");
Console.WriteLine(typeof(Program).Assembly.GetName().Name);
Console.WriteLine(typeof(Program).Assembly.GetName().Version);
#else
#error Missing SDK compilation symbols
#endif
"#;
        let cache = tempfile::tempdir().unwrap();
        let control = Arc::new(RunControl::default());
        let output = Arc::new(Mutex::new(String::new()));
        let captured = output.clone();
        let input = control.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.kind == "stdout" || event.kind == "stderr" {
                captured.lock().unwrap().push_str(&event.text);
                if event.text.contains("Name?") {
                    writeln!(input.input.lock().unwrap().as_mut().unwrap(), "中文").unwrap();
                }
            }
        });
        assert_eq!(
            execute(&request("csharp", source), cache.path(), &control, sink).unwrap(),
            Some(0),
            "{}",
            output.lock().unwrap()
        );
        let text = output.lock().unwrap();
        assert!(text.contains("你好 中文 6"), "{text}");
        assert!(text.contains("Run"));
        assert!(text.contains("1.0.0.0"));
    }

    #[test]
    #[ignore = "requires locally installed Kotlin compiler and JDK"]
    fn kotlin_script_cache_preserves_declarations_errors_and_invalidations() {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("cache");
        let mut req = request("kotlin", "@file:Suppress(\"UNUSED_VARIABLE\")\npackage `my-test`\nimport java.io.File\nval base = 40\nfun add(value: Int) = base + value\nclass Item(val value: Int)\nprintln(Item(add(2)).value)\nprintln(args.size)");
        req.file_path = Some(
            root.path()
                .join("demo $ script.kts")
                .to_string_lossy()
                .into(),
        );
        let execute_source = |req: &ScriptRequest| {
            let text = Arc::new(Mutex::new(String::new()));
            let output = text.clone();
            let code = execute(
                req,
                &cache,
                &RunControl::default(),
                Arc::new(move |event| {
                    if event.kind == "stdout" || event.kind == "stderr" {
                        output.lock().unwrap().push_str(&event.text);
                    }
                }),
            )
            .unwrap();
            let text = text.lock().unwrap().clone();
            (code, text)
        };
        let (code, text) = execute_source(&req);
        assert_eq!(code, Some(0), "{text}");
        assert!(text.contains("42"));
        assert!(text.contains("0"));
        let mut renamed = req.clone();
        renamed.file_path = Some(root.path().join("second.kts").to_string_lossy().into());
        assert!(prepare(&renamed, &cache).unwrap().compile.is_some());
        let (code, text) = execute_source(&renamed);
        assert_eq!(code, Some(0), "{text}");
        assert!(text.contains("42"));
        // 返回原名也必须重编，不能拿另一个脚本生成的类继续运行。
        assert!(prepare(&req, &cache).unwrap().compile.is_some());
        assert_eq!(execute_source(&req).0, Some(0));
        let warm = prepare(&req, &cache).unwrap();
        assert!(warm.compile.is_none());
        assert!(warm.compiled_cache.is_some());
        let jar = PathBuf::from(
            warm.command
                .get_args()
                .skip_while(|arg| *arg != "-cp")
                .nth(1)
                .unwrap(),
        );
        let jar = std::env::split_paths(&jar).next().unwrap();
        fs::remove_file(&jar).unwrap();
        assert!(prepare(&req, &cache).unwrap().compile.is_some());
        req.source = "throw IllegalStateException(\"失败 中文\")".into();
        let (code, text) = execute_source(&req);
        assert_eq!(code, Some(1), "{text}");
        assert!(
            text.starts_with("java.lang.IllegalStateException: 失败 中文"),
            "{text}"
        );
        assert!(!text.contains("InvocationTargetException"), "{text}");
        assert!(!text.contains("MdeKtsLauncher"), "{text}");
        assert!(prepare(&req, &cache).unwrap().compile.is_some());
        req.source = "this is not valid Kotlin".into();
        let (code, text) = execute_source(&req);
        assert_ne!(code, Some(0));
        assert!(!text.contains("42"));
        req.source = "println(43)".into();
        let (code, text) = execute_source(&req);
        assert_eq!(code, Some(0), "{text}");
        assert!(text.contains("43"));
        assert!(!text.contains("42"));
    }

    #[test]
    #[ignore = "requires locally installed Kotlin compiler and JDK"]
    fn kotlin_cold_compile_creates_a_jar_before_cache_reuse() {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("empty-cache");
        assert!(!cache.exists());
        let mut req = request("kotlin", "fun main() { println(\"冷编译 中文 42\") }");
        req.file_path = Some(root.path().join("Main.kt").to_string_lossy().into());
        let cold = prepare(&req, &cache).unwrap();
        let compiler = cold.compile.as_ref().expect("空缓存必须启动编译器");
        assert!(compiler
            .get_args()
            .all(|arg| !arg.to_string_lossy().contains("TieredStopAtLevel")));
        let (marker, digest) = cold.compiled_cache.as_ref().unwrap();
        let jar = marker.parent().unwrap().join("app.jar");
        assert!(!jar.exists());
        assert!(!marker.exists());
        let text = Arc::new(Mutex::new(String::new()));
        let output = text.clone();
        let code = execute(
            &req,
            &cache,
            &RunControl::default(),
            Arc::new(move |event| {
                if event.kind == "stdout" || event.kind == "stderr" {
                    output.lock().unwrap().push_str(&event.text);
                }
            }),
        )
        .unwrap();
        assert_eq!(code, Some(0), "{}", text.lock().unwrap());
        assert!(fs::metadata(&jar).unwrap().len() > 0);
        assert_eq!(fs::read_to_string(marker).unwrap(), *digest);
        assert!(text.lock().unwrap().contains("冷编译 中文 42"));
        assert!(prepare(&req, &cache).unwrap().compile.is_none());
    }

    #[test]
    #[ignore = "requires locally installed Kotlin compiler and JDK"]
    fn kotlin_cached_script_can_be_stopped() {
        let root = tempfile::tempdir().unwrap();
        let mut req = request(
            "kotlin",
            "println(\"started-script\"); Thread.sleep(500); println(42)",
        );
        req.file_path = Some(root.path().join("Stop.kts").to_string_lossy().into());
        assert_eq!(
            execute(&req, root.path(), &RunControl::default(), Arc::new(|_| {})).unwrap(),
            Some(0)
        );
        assert!(prepare(&req, root.path()).unwrap().compile.is_none());
        let control = Arc::new(RunControl::default());
        let cancel = control.clone();
        let sink: Sink = Arc::new(move |event| {
            if event.kind == "stdout" && event.text.contains("started-script") {
                cancel.cancelled.store(true, Ordering::SeqCst);
            }
        });
        let start = Instant::now();
        execute(&req, root.path(), &control, sink).unwrap();
        assert!(control.cancelled.load(Ordering::SeqCst));
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
