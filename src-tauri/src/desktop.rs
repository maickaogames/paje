//! Recursos do app Windows: modo Picture-in-Picture (janela compacta sempre
//! no topo), atalhos globais e atualização com barra de progresso.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{Emitter, LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/* ---------------- Picture-in-Picture ---------------- */

#[derive(Default)]
pub struct PipState(Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>, bool)>>);

/// Enquanto o PiP estiver aberto, reafirma a janela como TOPMOST: jogos e
/// outros programas que pedem "sempre no topo" depois não conseguem cobri-la.
static PIP_ON: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn force_topmost(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };
    if let Ok(h) = window.hwnd() {
        let hwnd = HWND(h.0 as _);
        unsafe {
            let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
}
#[cfg(not(windows))]
fn force_topmost(_window: &WebviewWindow) {}

fn keep_on_top(window: WebviewWindow) {
    use std::sync::atomic::Ordering;
    if PIP_ON.swap(true, Ordering::SeqCst) {
        return; // já existe um vigia rodando
    }
    std::thread::spawn(move || {
        while PIP_ON.load(Ordering::SeqCst) {
            let w = window.clone();
            let _ = window.run_on_main_thread(move || force_topmost(&w));
            std::thread::sleep(std::time::Duration::from_millis(1500));
        }
    });
}

#[tauri::command]
pub fn set_pip_mode(
    window: WebviewWindow,
    state: tauri::State<'_, PipState>,
    enabled: bool,
    width: f64,
    height: f64,
    corner: String,
) -> Result<(), String> {
    let mut saved = state.0.lock().map_err(err)?;
    if enabled {
        if saved.is_none() {
            let pos = window.outer_position().map_err(err)?;
            let size = window.inner_size().map_err(err)?;
            let max = window.is_maximized().unwrap_or(false);
            *saved = Some((pos, size, max));
        }
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(err)?;
        }
        window.set_decorations(false).map_err(err)?;
        window.set_always_on_top(true).map_err(err)?;
        window.set_size(LogicalSize::new(width, height)).map_err(err)?;
        if let Some(m) = window.current_monitor().ok().flatten() {
            let scale = m.scale_factor();
            let (mx, my) = (m.position().x, m.position().y);
            let (mw, mh) = (m.size().width as i32, m.size().height as i32);
            let w = (width * scale) as i32;
            let h = (height * scale) as i32;
            let margin = (16.0 * scale) as i32;
            let taskbar = (64.0 * scale) as i32;
            let x = if corner.ends_with("left") { mx + margin } else { mx + mw - w - margin };
            let y = if corner.starts_with("top") { my + margin } else { my + mh - h - taskbar };
            window.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
        }
        let _ = window.set_visible_on_all_workspaces(true);
        force_topmost(&window);
        keep_on_top(window.clone());
    } else {
        PIP_ON.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = window.set_visible_on_all_workspaces(false);
        window.set_always_on_top(false).map_err(err)?;
        window.set_decorations(true).map_err(err)?;
        if let Some((pos, size, max)) = saved.take() {
            window.set_size(size).map_err(err)?;
            window.set_position(pos).map_err(err)?;
            if max {
                window.maximize().map_err(err)?;
            }
        }
    }
    Ok(())
}

/* ---------------- Atalhos globais ---------------- */

#[derive(Deserialize)]
pub struct HotkeyBinding {
    action: String,
    accelerator: String,
}

/// Registra os atalhos (funcionam mesmo com o jogo em foco). Retorna os que falharam.
#[tauri::command]
pub fn set_hotkeys(app: tauri::AppHandle, keys: Vec<HotkeyBinding>) -> Result<Vec<String>, String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(err)?;
    let mut failed = Vec::new();
    for k in keys {
        let action = k.action.clone();
        let res = gs.on_shortcut(k.accelerator.as_str(), move |app, _shortcut, ev| {
            if ev.state == ShortcutState::Pressed {
                let _ = app.emit("paje-hotkey", action.clone());
            }
        });
        if res.is_err() {
            failed.push(k.accelerator);
        }
    }
    Ok(failed)
}

/* ---------------- Atualização ---------------- */

const LATEST_URL: &str = "https://github.com/maickaogames/paje/releases/latest/download/latest.json";

fn current_build() -> u64 {
    option_env!("PAJE_BUILD").and_then(|s| s.parse().ok()).unwrap_or(0)
}

#[derive(Deserialize)]
struct Latest {
    build: u64,
    url: String,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    current: u64,
    latest: u64,
    available: bool,
    url: String,
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let latest: Latest = ureq::get(LATEST_URL).call().map_err(err)?.into_json().map_err(err)?;
        let current = current_build();
        Ok(UpdateInfo { current, latest: latest.build, available: latest.build > current, url: latest.url })
    })
    .await
    .map_err(err)?
}

/// Baixa o instalador mostrando o progresso (0–100), instala em silêncio e reabre o Pajé.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, url: String, on_progress: Channel<u32>) -> Result<(), String> {
    let setup = tauri::async_runtime::spawn_blocking(move || -> Result<std::path::PathBuf, String> {
        let resp = ureq::get(&url).call().map_err(err)?;
        let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let path = std::env::temp_dir().join("Paje-Setup-update.exe");
        let mut file = std::fs::File::create(&path).map_err(err)?;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 64 * 1024];
        let (mut done, mut last) = (0u64, 0u32);
        loop {
            let n = reader.read(&mut buf).map_err(err)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(err)?;
            done += n as u64;
            if total > 0 {
                let pct = ((done * 100) / total).min(99) as u32;
                if pct != last {
                    last = pct;
                    let _ = on_progress.send(pct);
                }
            }
        }
        file.flush().map_err(err)?;
        let _ = on_progress.send(100);
        Ok(path)
    })
    .await
    .map_err(err)??;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(err)?;
        std::process::Command::new("cmd")
            .raw_arg(format!(
                "/C ping -n 4 127.0.0.1 >nul & \"{}\" /S & start \"\" \"{}\"",
                setup.display(),
                exe.display()
            ))
            .creation_flags(0x0800_0000) // sem janela de console
            .spawn()
            .map_err(err)?;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            app.exit(0);
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (app, setup);
    }
    Ok(())
}
