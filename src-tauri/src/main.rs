// Pajé para Windows: janela nativa (WebView2) que abre o Pajé publicado e
// oferece captura de áudio de UM processo escolhido (WASAPI process loopback),
// PiP sempre no topo, atalhos globais e atualização automática.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod desktop;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(capture::CaptureState::default())
        .manage(desktop::PipState::default())
        .invoke_handler(tauri::generate_handler![
            capture::list_audio_processes,
            capture::start_process_audio_capture,
            capture::stop_process_audio_capture,
            desktop::set_pip_mode,
            desktop::set_hotkeys,
            desktop::check_update,
            desktop::install_update
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Pajé");
}
