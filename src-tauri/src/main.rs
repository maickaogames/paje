// Pajé para Windows: janela nativa (WebView2) que abre o Pajé publicado.
// A captura de áudio por processo (WASAPI) ainda NÃO está implementada aqui.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Pajé");
}
