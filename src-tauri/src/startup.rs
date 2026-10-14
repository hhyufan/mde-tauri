use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::startup_gate::StartupGate;

#[derive(Default)]
pub struct StartupState(Mutex<StartupGate>);

pub fn is_starting(app: &AppHandle) -> bool {
    app.try_state::<StartupState>()
        .is_some_and(|state| !state.0.lock().unwrap().finished)
}

#[cfg(not(target_os = "android"))]
fn hand_over(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    // Remove the always-on-top splash before transferring focus. Showing a
    // hidden window alone does not restore a minimized window or activate it.
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.set_always_on_top(false);
        if let Err(error) = splash.close() {
            eprintln!("[startup] Could not close splash: {error}");
        }
    }
    main.set_focus().map_err(|error| error.to_string())?;
    app.state::<StartupState>().0.lock().unwrap().finished = true;
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn request_handover(app: AppHandle, force: bool) {
    let delay = app
        .state::<StartupState>()
        .0
        .lock()
        .unwrap()
        .schedule(Instant::now(), force);
    let Some(delay) = delay else { return };
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) = hand_over(&handle) {
                handle.state::<StartupState>().0.lock().unwrap().scheduled = false;
                eprintln!("[startup] Window handover failed: {error}");
            }
        }) {
            app.state::<StartupState>().0.lock().unwrap().scheduled = false;
            eprintln!("[startup] Could not schedule window handover: {error}");
        }
    });
}

// If either page fails, do not leave the application permanently invisible.
pub fn install_watchdog(app: &AppHandle) {
    #[cfg(not(target_os = "android"))]
    {
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(10));
            request_handover(handle, true);
        });
    }
    #[cfg(target_os = "android")]
    let _ = app;
}

#[tauri::command]
pub fn splash_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
    dark: bool,
) -> Result<(), String> {
    if window.label() != "splash" {
        return Err("Only the splash window can announce its first frame".into());
    }
    #[cfg(not(target_os = "android"))]
    {
        if app.state::<StartupState>().0.lock().unwrap().scheduled {
            return Ok(());
        }
        let background = if dark { (18, 18, 18) } else { (245, 245, 247) };
        window
            .set_background_color(Some(tauri::window::Color(
                background.0,
                background.1,
                background.2,
                255,
            )))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        app.state::<StartupState>().0.lock().unwrap().splash_shown = Some(Instant::now());
        request_handover(app, false);
    }
    #[cfg(target_os = "android")]
    let _ = (app, dark);
    Ok(())
}

#[tauri::command]
pub fn main_window_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
    dark: Option<bool>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can announce readiness".into());
    }
    #[cfg(not(target_os = "android"))]
    {
        if app.state::<StartupState>().0.lock().unwrap().scheduled {
            return Ok(());
        }
        if let Some(dark) = dark {
            let (r, g, b) = if dark { (18, 18, 18) } else { (245, 245, 247) };
            window
                .set_background_color(Some(tauri::window::Color(r, g, b, 255)))
                .map_err(|error| error.to_string())?;
        }
        app.state::<StartupState>().0.lock().unwrap().main_ready = true;
        let no_splash = app.get_webview_window("splash").is_none();
        request_handover(app.clone(), no_splash);
        // A broken splash page must not hold an already usable editor hostage.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(750));
            request_handover(app, true);
        });
    }
    #[cfg(target_os = "android")]
    let _ = (app, dark);
    Ok(())
}
