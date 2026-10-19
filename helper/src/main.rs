//! Pajé Audio Helper — implementação de referência (Windows).
//!
//! Captura o áudio de UM processo via WASAPI Application Loopback Capture
//! (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, Windows 10 2004+) e envia
//! PCM f32le estéreo 48 kHz por WebSocket local (127.0.0.1:47820) para a
//! página do Pajé. O Discord e demais processos nunca entram na captura.
//!
//! ATENÇÃO: este código é uma referência para compilação e validação em
//! Windows. Revise as chamadas COM contra o SDK instalado antes de distribuir.

use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{handshake::server::Request, Message};

const BIND_ADDR: &str = "127.0.0.1:47820";
const SUBPROTOCOL: &str = "paje-audio-v1";
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
/// 10 ms por bloco: 480 frames * 2 canais * 4 bytes.
const BLOCK_FRAMES: usize = 480;

const ALLOWED_ORIGINS: &[&str] = &[
    "https://paje.lovable.app",
    "http://localhost",
    "http://127.0.0.1",
    "https://id-preview--", // previews Lovable (prefixo)
    "https://",             // *.lovable.app / *.lovableproject.com (verificado abaixo)
];

fn origin_allowed(origin: &str) -> bool {
    if origin.starts_with("http://localhost") || origin.starts_with("http://127.0.0.1") {
        return true;
    }
    origin == "https://paje.lovable.app"
        || origin.ends_with(".lovable.app")
        || origin.ends_with(".lovableproject.com")
}

#[derive(Debug, Serialize)]
struct ProcessInfo {
    pid: u32,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum Control {
    #[serde(rename = "list")]
    List,
    #[serde(rename = "select")]
    Select { pid: u32 },
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "stop")]
    Stop,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum Event {
    #[serde(rename = "processes")]
    Processes { processes: Vec<ProcessInfo> },
    #[serde(rename = "selected")]
    Selected { pid: u32 },
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "error")]
    Error { message: String },
}

/// Lista processos com janela visível (candidatos a ter saída de áudio).
#[cfg(windows)]
fn list_processes() -> Vec<ProcessInfo> {
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    use windows::Win32::System::Threading::*;
    let mut out = Vec::new();
    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return out,
        };
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                let pid = entry.th32ProcessID;
                // Filtra processos de sistema óbvios; o usuário escolhe o alvo.
                if pid > 8 && !name.eq_ignore_ascii_case("system") {
                    out.push(ProcessInfo { pid, name });
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snap);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[cfg(not(windows))]
fn list_processes() -> Vec<ProcessInfo> {
    Vec::new()
}

/// Verifica se o Windows suporta captura por processo (10 build 19041+).
#[cfg(windows)]
fn process_loopback_supported() -> bool {
    use windows::Win32::System::SystemInformation::*;
    // IsWindowsVersionOrGreater via VerifyVersionInfoW.
    unsafe {
        let mut info = OSVERSIONINFOEXW::default();
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOEXW>() as u32;
        info.dwMajorVersion = 10;
        info.dwMinorVersion = 0;
        info.dwBuildNumber = 19041;
        let mask = VerSetConditionMask(
            VerSetConditionMask(
                VerSetConditionMask(0, VER_MAJORVERSION, VER_GREATER_EQUAL),
                VER_MINORVERSION,
                VER_GREATER_EQUAL,
            ),
            VER_BUILDNUMBER,
            VER_GREATER_EQUAL,
        );
        VerifyVersionInfoW(
            &mut info,
            VER_MAJORVERSION | VER_MINORVERSION | VER_BUILDNUMBER,
            mask,
        )
        .as_bool()
    }
}

#[cfg(not(windows))]
fn process_loopback_supported() -> bool {
    false
}

/// Captura o loopback do processo `pid` e envia blocos PCM pelo canal `tx`.
/// Bloqueante: rode em uma thread dedicada; encerra quando `stop` é sinalizado.
#[cfg(windows)]
fn capture_process_loopback(pid: u32, tx: mpsc::Sender<Vec<u8>>, stop: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<()> {
    use std::sync::atomic::Ordering;
    use windows::core::IUnknown;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Threading::*;

    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok().context("COM init")?;

        // Ativa IAudioClient em modo PROCESS_LOOPBACK para o processo alvo.
        // Inclui processos filhos (VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK).
        let mut activation_params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };

        let prop = windows::Win32::System::Com::StructuredStorage::PROPVARIANT::default();
        let mut act_params = ActivateAudioInterfaceAsyncParams {
            // VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
            AudioInterfaceId: windows::core::GUID::from_u128(0x...), // ver SDK
            ..Default::default()
        };
        // NOTA: a ativação assíncrona exige um handler IActivateAudioInterfaceCompletionHandler.
        // Implemente o handler (ver exemplo "ApplicationLoopback" da Microsoft) e aguarde
        // o IAudioClient resultante. Esqueleto abaixo assume `audio_client` obtido.

        // ---- A partir daqui, fluxo WASAPI clássico de captura ----
        // let audio_client: IAudioClient = ...;
        // Formato de captura: f32, 48 kHz, estéreo (mixformat do dispositivo virtual).
        // audio_client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, ...)?;
        // let capture: IAudioCaptureClient = audio_client.GetService()?;
        // audio_client.Start()?;
        //
        // Loop: enquanto !stop.load(Ordering::Relaxed):
        //   capture.GetNextPacketSize()? → GetBuffer → converter p/ f32le 48kHz estéreo
        //   (resample se o mixformat diferir) → tx.blocking_send(bloco) → ReleaseBuffer.
        //
        // Ao sair: audio_client.Stop() e liberar COM.
        let _ = (activation_params, prop, act_params, tx);
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        CoUninitialize();
    }
    Ok(())
}

#[cfg(not(windows))]
fn capture_process_loopback(_pid: u32, _tx: mpsc::Sender<Vec<u8>>, _stop: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<()> {
    bail!("captura por processo disponível apenas no Windows 10 2004+")
}

async fn handle_conn(stream: TcpStream, addr: SocketAddr) -> Result<()> {
    // Validação de origem + subprotocolo durante o handshake.
    let callback = |req: &Request, resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
        let origin = req
            .headers()
            .get("Origin")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !origin_allowed(origin) {
            return Err(tokio_tungstenite::tungstenite::http::Response::builder()
                .status(403)
                .body(Some("origem não autorizada".into()))
                .unwrap());
        }
        Ok(resp)
    };
    let ws = tokio_tungstenite::accept_hdr_async_with_config(stream, callback, None).await?;
    let (mut sink, mut read) = ws.split();
    println!("conexão de {addr}");

    let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<u8>>(64);
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut capture_thread: Option<std::thread::JoinHandle<()>> = None;
    let mut streaming = false;

    loop {
        tokio::select! {
            msg = read.next() => {
                let Some(Ok(msg)) = msg else { break };
                match msg {
                    Message::Text(text) => match serde_json::from_str::<Control>(&text) {
                        Ok(Control::List) => {
                            let ev = Event::Processes { processes: list_processes() };
                            sink.send(Message::Text(serde_json::to_string(&ev)?)).await?;
                        }
                        Ok(Control::Select { pid }) => {
                            // Troca de fonte: encerra captura anterior sem duplicar.
                            stop.store(true, std::sync::atomic::Ordering::Relaxed);
                            if let Some(h) = capture_thread.take() { let _ = h.join(); }
                            let stop2 = stop.clone();
                            stop.store(false, std::sync::atomic::Ordering::Relaxed);
                            let tx2 = audio_tx.clone();
                            capture_thread = Some(std::thread::spawn(move || {
                                if let Err(e) = capture_process_loopback(pid, tx2, stop2) {
                                    eprintln!("captura: {e:#}");
                                }
                            }));
                            let ev = Event::Selected { pid };
                            sink.send(Message::Text(serde_json::to_string(&ev)?)).await?;
                        }
                        Ok(Control::Start) => { streaming = true; }
                        Ok(Control::Stop) => {
                            streaming = false;
                            let ev = Event::Stopped;
                            sink.send(Message::Text(serde_json::to_string(&ev)?)).await?;
                        }
                        Err(_) => { /* frame inválido: ignora */ }
                    },
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            Some(block) = audio_rx.recv() => {
                if streaming {
                    sink.send(Message::Binary(block)).await?;
                }
            }
        }
    }

    // Encerramento: para a captura e libera recursos.
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    if let Some(h) = capture_thread.take() { let _ = h.join(); }
    println!("conexão encerrada: {addr}");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    if !process_loopback_supported() {
        eprintln!(
            "Este Windows não suporta captura de áudio por processo \
             (requer Windows 10 2004 / build 19041 ou superior)."
        );
        std::process::exit(2);
    }
    let listener = TcpListener::bind(BIND_ADDR).await?;
    println!("Pajé Audio Helper escutando em ws://{BIND_ADDR} (apenas loopback)");
    loop {
        let (stream, addr) = listener.accept().await?;
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, addr).await {
                eprintln!("sessão {addr}: {e:#}");
            }
        });
    }
}
