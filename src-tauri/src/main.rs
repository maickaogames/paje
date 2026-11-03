// Pajé para Windows: janela nativa (WebView2) que abre o Pajé publicado e
// oferece captura de áudio de UM processo escolhido (WASAPI process loopback),
// para transmitir o som do jogo sem incluir o Discord.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;

fn main() {
    tauri::Builder::default()
        .manage(capture::CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            capture::list_audio_processes,
            capture::start_process_audio_capture,
            capture::stop_process_audio_capture
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Pajé");
}
