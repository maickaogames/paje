//! Captura de áudio por processo (Windows 10 2004+ / 11).
//! Envia PCM f32le estéreo 48 kHz intercalado ao frontend por um Channel.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

#[derive(Serialize, Clone)]
pub struct AudioProcess {
    pid: u32,
    name: String,
}

#[derive(Default)]
pub struct CaptureState(Mutex<Option<Arc<AtomicBool>>>);

#[tauri::command]
pub fn list_audio_processes() -> Vec<AudioProcess> {
    imp::list_processes()
}

#[tauri::command]
pub fn start_process_audio_capture(
    pid: u32,
    on_audio: Channel<InvokeResponseBody>,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(old) = guard.take() {
        old.store(true, Ordering::SeqCst);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *guard = Some(stop.clone());
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || imp::run_capture(pid, on_audio, stop, tx));
    // Espera a ativação real: erro aqui significa que nada é transmitido.
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "tempo esgotado ao iniciar captura".to_string())?
}

#[tauri::command]
pub fn stop_process_audio_capture(state: tauri::State<'_, CaptureState>) {
    if let Ok(mut g) = state.0.lock() {
        if let Some(s) = g.take() {
            s.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn list_processes() -> Vec<AudioProcess> {
        vec![]
    }
    pub fn run_capture(
        _pid: u32,
        _ch: Channel<InvokeResponseBody>,
        _stop: Arc<AtomicBool>,
        tx: std::sync::mpsc::Sender<Result<(), String>>,
    ) {
        let _ = tx.send(Err("disponível apenas no Windows".into()));
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::collections::HashSet;
    use windows::core::{implement, w, Interface, IUnknown, Result as WinResult, HRESULT};
    use windows::Win32::Foundation::{BOOL, CloseHandle, HANDLE, HWND, LPARAM, MAX_PATH};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{
        CreateEventW, OpenProcess, QueryFullProcessImageNameW, SetEvent, WaitForSingleObject,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
    };

    // ---------- Lista de processos com janela visível ----------
    unsafe extern "system" fn enum_cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        let pids = &mut *(lp.0 as *mut Vec<u32>);
        if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 {
                pids.push(pid);
            }
        }
        BOOL(1)
    }

    fn exe_name(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; MAX_PATH as usize];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                h,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(h);
            ok.ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            path.rsplit('\\').next().map(|s| s.to_string())
        }
    }

    pub fn list_processes() -> Vec<AudioProcess> {
        let mut pids: Vec<u32> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut pids as *mut _ as isize));
        }
        let me = std::process::id();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for pid in pids {
            if pid == me || !seen.insert(pid) {
                continue;
            }
            if let Some(name) = exe_name(pid) {
                let lower = name.to_lowercase();
                // O Discord nunca é oferecido: é justamente o som a evitar.
                if lower.starts_with("discord") || lower == "explorer.exe" {
                    continue;
                }
                out.push(AudioProcess { pid, name });
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }

    // ---------- Ativação assíncrona do loopback de processo ----------
    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct Done(HANDLE);

    impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
        fn ActivateCompleted(
            &self,
            _op: Option<&IActivateAudioInterfaceAsyncOperation>,
        ) -> WinResult<()> {
            unsafe { SetEvent(self.0) }
        }
    }

    /// Layout x64 de PROPVARIANT com VT_BLOB.
    #[repr(C)]
    struct BlobVariant {
        vt: u16,
        r1: u16,
        r2: u16,
        r3: u16,
        cb: u32,
        p: *mut u8,
    }

    const VT_BLOB: u16 = 65;
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const FRAME_BYTES: usize = 8; // 2 canais x f32

    unsafe fn activate(pid: u32) -> WinResult<IAudioClient> {
        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };
        let pv = BlobVariant {
            vt: VT_BLOB,
            r1: 0,
            r2: 0,
            r3: 0,
            cb: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            p: &mut params as *mut _ as *mut u8,
        };
        let evt = CreateEventW(None, false, false, None)?;
        let handler: IActivateAudioInterfaceCompletionHandler = Done(evt).into();
        let op = ActivateAudioInterfaceAsync(
            w!("VAD\\Process_Loopback"),
            &IAudioClient::IID,
            Some(&pv as *const BlobVariant as *const _),
            &handler,
        )?;
        WaitForSingleObject(evt, 5000);
        let _ = CloseHandle(evt);
        let mut hr = HRESULT(0);
        let mut unk: Option<IUnknown> = None;
        op.GetActivateResult(&mut hr, &mut unk)?;
        hr.ok()?;
        unk.ok_or_else(|| windows::core::Error::from(HRESULT(-2147467259)))?
            .cast::<IAudioClient>()
    }

    unsafe fn setup(pid: u32) -> WinResult<(IAudioClient, IAudioCaptureClient, HANDLE)> {
        let client = activate(pid)?;
        let fmt = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
            nChannels: 2,
            nSamplesPerSec: 48000,
            nAvgBytesPerSec: 48000 * FRAME_BYTES as u32,
            nBlockAlign: FRAME_BYTES as u16,
            wBitsPerSample: 32,
            cbSize: 0,
        };
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            200_000, // 20 ms
            0,
            &fmt,
            None,
        )?;
        let evt = CreateEventW(None, false, false, None)?;
        client.SetEventHandle(evt)?;
        let cap: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        Ok((client, cap, evt))
    }

    pub fn run_capture(
        pid: u32,
        ch: Channel<InvokeResponseBody>,
        stop: Arc<AtomicBool>,
        tx: std::sync::mpsc::Sender<Result<(), String>>,
    ) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let (client, cap, evt) = match setup(pid) {
                Ok(v) => v,
                Err(e) => {
                    let _ = tx.send(Err(format!("não foi possível capturar este aplicativo: {e}")));
                    CoUninitialize();
                    return;
                }
            };
            let _ = tx.send(Ok(()));
            let mut out: Vec<u8> = Vec::with_capacity(48000 / 50 * FRAME_BYTES * 2);
            while !stop.load(Ordering::SeqCst) {
                WaitForSingleObject(evt, 100);
                loop {
                    let n = match cap.GetNextPacketSize() {
                        Ok(n) => n,
                        Err(_) => {
                            stop.store(true, Ordering::SeqCst);
                            break;
                        }
                    };
                    if n == 0 {
                        break;
                    }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    if cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                        break;
                    }
                    let bytes = frames as usize * FRAME_BYTES;
                    if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                        out.extend(std::iter::repeat(0u8).take(bytes));
                    } else {
                        out.extend_from_slice(std::slice::from_raw_parts(data, bytes));
                    }
                    let _ = cap.ReleaseBuffer(frames);
                }
                if !out.is_empty() {
                    if ch.send(InvokeResponseBody::Raw(std::mem::take(&mut out))).is_err() {
                        break; // janela fechada/recarregada
                    }
                }
            }
            let _ = client.Stop();
            let _ = CloseHandle(evt);
            drop(cap);
            drop(client);
            CoUninitialize();
        }
    }
}
