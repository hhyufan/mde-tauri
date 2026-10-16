#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{path::PathBuf, process::Command, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::Duration};
use tauri::{Emitter, Manager};

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));
#[derive(Default, Clone)]
struct InstallState { running: Arc<AtomicBool>, installed: Arc<Mutex<Option<PathBuf>>> }
#[derive(Clone, serde::Serialize)]
struct Progress { stage: String, percent: u8 }

fn emit(app: &tauri::AppHandle, stage: &str, percent: u8) {
    let _ = app.emit("install-progress", Progress { stage: stage.into(), percent });
}
#[tauri::command]
fn default_install_directory() -> Result<String, String> {
    std::env::var_os("LOCALAPPDATA").map(|base|PathBuf::from(base).join("mokidown").to_string_lossy().into_owned()).ok_or_else(||"无法读取当前用户的安装目录".into())
}
fn validate_directory(value: &str) -> Result<PathBuf,String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || path.parent().is_none() || value.contains(['\r','\n','"']) || path.components().any(|c|matches!(c,std::path::Component::ParentDir)) {
        return Err("请选择有效的绝对安装路径".into());
    }
    if path.is_file() { return Err("安装位置指向一个文件，请选择文件夹".into()); }
    Ok(path)
}
fn read_progress(app: &tauri::AppHandle, file: &std::path::Path, previous: &mut String) {
    if let Ok(content)=std::fs::read_to_string(file) {
        // Read complete ASCII records only; NSIS may still be appending a line.
        if let Some(line)=content.rsplit_once('\n').and_then(|(complete,_)|complete.lines().next_back()) {
            if line!=previous {
                if let Some((number,stage))=line.trim().split_once('|') {
                    if let Ok(percent)=number.parse::<u8>() {
                        if percent<=100 { emit(app,stage,percent); *previous=line.into(); }
                    }
                }
            }
        }
    }
}
#[tauri::command]
async fn install_application(app: tauri::AppHandle, state: tauri::State<'_,InstallState>, directory:String) -> Result<(),String> {
    let folder=validate_directory(&directory)?;
    if state.running.swap(true,Ordering::SeqCst) { return Err("安装正在进行".into()); }
    let state=state.inner().clone();
    let running=state.running.clone();
    let result=tauri::async_runtime::spawn_blocking(move || {
        if PAYLOAD.is_empty() { return Err("当前开发构建未包含安装文件，请运行 npm run installer:bundle".into()); }
        emit(&app,"preparing",3);
        let temp=tempfile::Builder::new().prefix("mokidown-setup-").tempdir().map_err(|e|e.to_string())?;
        let setup=temp.path().join("setup.exe");
        let progress=temp.path().join("progress.txt");
        std::fs::write(&setup,PAYLOAD).map_err(|e|e.to_string())?;
        let mut command=Command::new(&setup);
        command.arg("/S").arg(format!("/MOKI_PROGRESS={}",progress.display()));
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            // NSIS requires /D to be last and unquoted. No shell is involved.
            command.raw_arg(format!("/D={}",folder.display())).creation_flags(0x08000000);
        }
        #[cfg(not(windows))] command.arg(format!("/D={}",folder.display()));
        let mut child=command.spawn().map_err(|e|e.to_string())?;
        let mut previous=String::new();
        loop {
            read_progress(&app,&progress,&mut previous);
            match child.try_wait().map_err(|e|e.to_string())? {
                Some(status)=>{
                    if !status.success() { return Err(format!("安装未完成（代码 {}）。请先关闭正在运行的 MokiDown，并确认所选目录可写后重试。",status.code().unwrap_or(-1))); }
                    let executable=folder.join("mokidown.exe");
                    if !executable.is_file() { return Err("安装程序未在所选目录创建应用，请检查安装路径".into()); }
                    *state.installed.lock().map_err(|e|e.to_string())?=Some(executable);
                    emit(&app,"complete",100);return Ok(());
                },
                None=>std::thread::sleep(Duration::from_millis(150)),
            }
        }
    }).await.map_err(|e|e.to_string()).and_then(|result|result);
    running.store(false,Ordering::SeqCst);
    result
}
#[tauri::command]
fn launch_application(state:tauri::State<'_,InstallState>)->Result<(),String> {
    let app=state.installed.lock().map_err(|e|e.to_string())?.clone().ok_or("请先完成安装")?;
    Command::new(app).spawn().map_err(|e|e.to_string())?;Ok(())
}
fn main() {
    tauri::Builder::default()
        .manage(InstallState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![default_install_directory,install_application,launch_application])
        .on_window_event(|window,event| {
            if let tauri::WindowEvent::CloseRequested{api,..}=event {
                if window.state::<InstallState>().running.load(Ordering::SeqCst) { api.prevent_close(); }
            }
        })
        .run(tauri::generate_context!()).expect("Could not start MokiDown installer");
}
