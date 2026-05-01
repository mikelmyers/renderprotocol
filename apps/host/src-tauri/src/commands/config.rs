// Tauri commands for the configuration substrate.
//
// Read-only from the surface in v0 (the user edits markdown files
// directly; the watcher reloads them). The only write is
// `config_set_active_agent`, which selects which `agent.md` is the
// active operating contract.

use tauri::State;

use crate::config_store::ConfigSnapshot;
use crate::AppState;

#[tauri::command]
pub fn config_snapshot(state: State<'_, AppState>) -> ConfigSnapshot {
    state.config.snapshot()
}

#[tauri::command]
pub fn config_set_active_agent(
    state: State<'_, AppState>,
    key: String,
) -> Result<ConfigSnapshot, String> {
    if !state.config.set_active_agent(&key) {
        return Err(format!("agent '{}' is not loaded", key));
    }
    Ok(state.config.snapshot())
}
