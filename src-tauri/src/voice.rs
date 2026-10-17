//! Streaming voice input (macOS SFSpeechRecognizer). Non-macOS builds are stubs.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

const EVENT_PARTIAL: &str = "voice-partial";
const EVENT_FINAL: &str = "voice-final";
const EVENT_ERROR: &str = "voice-error";
const EVENT_SILENCE: &str = "voice-silence";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoicePayload {
    text: String,
    confidence: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceErrorPayload {
    message: String,
}

pub struct VoiceState {
    listening: AtomicBool,
    /// Heap `AppHandle` passed to the ObjC callback; freed on stop.
    callback_ctx: Mutex<Option<usize>>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            listening: AtomicBool::new(false),
            callback_ctx: Mutex::new(None),
        }
    }
}

pub fn init_state() -> VoiceState {
    VoiceState::new()
}

#[cfg(target_os = "macos")]
mod ffi {
    use std::os::raw::{c_char, c_double, c_int, c_void};

    pub type EventFn =
        Option<unsafe extern "C" fn(*const c_char, *const c_char, c_double, *mut c_void)>;

    unsafe extern "C" {
        pub fn mob_voice_supported() -> c_int;
        pub fn mob_voice_start(
            cb: EventFn,
            ctx: *mut c_void,
            err: *mut c_char,
            err_len: usize,
        ) -> c_int;
        pub fn mob_voice_stop();
    }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn native_event(
    kind: *const std::os::raw::c_char,
    text: *const std::os::raw::c_char,
    confidence: f64,
    ctx: *mut std::os::raw::c_void,
) {
    if ctx.is_null() || kind.is_null() {
        return;
    }
    let app = &*(ctx as *const AppHandle);
    let kind = std::ffi::CStr::from_ptr(kind).to_string_lossy();
    let text = if text.is_null() {
        String::new()
    } else {
        std::ffi::CStr::from_ptr(text).to_string_lossy().into_owned()
    };
    match kind.as_ref() {
        "partial" => {
            let _ = app.emit(EVENT_PARTIAL, VoicePayload { text, confidence });
        }
        "final" => {
            let _ = app.emit(EVENT_FINAL, VoicePayload { text, confidence });
        }
        "silence" => {
            let _ = app.emit(
                EVENT_SILENCE,
                VoicePayload {
                    text: String::new(),
                    confidence: 0.0,
                },
            );
        }
        "error" => {
            let _ = app.emit(EVENT_ERROR, VoiceErrorPayload { message: text });
        }
        _ => {}
    }
}

#[tauri::command]
pub fn voice_supported() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        ffi::mob_voice_supported() != 0
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[tauri::command]
pub fn voice_start(app: AppHandle, state: State<'_, VoiceState>) -> Result<(), String> {
    if state.listening.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        state.listening.store(false, Ordering::SeqCst);
        return Err("Voice input is only available on macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        free_ctx(&state);
        let boxed = Box::new(app.clone());
        let ctx = Box::into_raw(boxed) as *mut std::os::raw::c_void;

        let mut err = vec![0 as std::os::raw::c_char; 256];
        let rc = unsafe {
            ffi::mob_voice_start(Some(native_event), ctx, err.as_mut_ptr(), err.len())
        };
        if rc != 0 {
            unsafe {
                drop(Box::from_raw(ctx as *mut AppHandle));
            }
            state.listening.store(false, Ordering::SeqCst);
            let msg = unsafe { std::ffi::CStr::from_ptr(err.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            return Err(if msg.is_empty() {
                format!("voice start failed ({rc})")
            } else {
                msg
            });
        }
        *state.callback_ctx.lock().map_err(|e| e.to_string())? = Some(ctx as usize);
        Ok(())
    }
}

#[tauri::command]
pub fn voice_stop(state: State<'_, VoiceState>) -> Result<(), String> {
    if !state.listening.swap(false, Ordering::SeqCst) {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    unsafe {
        ffi::mob_voice_stop();
    }
    free_ctx(&state);
    Ok(())
}

fn free_ctx(state: &VoiceState) {
    if let Ok(mut guard) = state.callback_ctx.lock() {
        if let Some(ptr) = guard.take() {
            unsafe {
                drop(Box::from_raw(ptr as *mut AppHandle));
            }
        }
    }
}
