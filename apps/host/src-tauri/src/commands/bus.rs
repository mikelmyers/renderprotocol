// Frontend → Rust bus emit. The frontend calls this when something originates
// in the UI (a click, a keyboard selection, a reference click). Rust stamps
// the seq, fans the event back out via the EVENT_CHANNEL emitter, and
// (later) writes it to the audit log.

use tauri::{AppHandle, State};

use crate::bus::BusEvent;
use crate::AppState;

#[tauri::command]
pub fn bus_emit(app: AppHandle, state: State<'_, AppState>, event: BusEvent) -> Result<(), String> {
    state.bus.emit(&app, event);
    Ok(())
}
