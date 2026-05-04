// Tauri commands the React frontend invokes to read the current parsed
// state of `agent.md` and `user.md`. The watcher (see config_watcher.rs)
// owns updates; these commands only read from the in-memory store.
//
// Returning Option<ParsedDocument> rather than erroring on a missing file
// lets the frontend distinguish "config not present yet" from "config
// failed to load" (which would emit a warning event and keep the last
// good value).

use tauri::State;

use crate::config_parser::ParsedDocument;
use crate::AppState;

#[tauri::command]
pub fn current_agent_md(state: State<'_, AppState>) -> Result<Option<ParsedDocument>, String> {
    let s = state
        .config
        .lock()
        .map_err(|e| format!("config store lock poisoned: {e}"))?;
    Ok(s.agent.clone())
}

#[tauri::command]
pub fn current_user_md(state: State<'_, AppState>) -> Result<Option<ParsedDocument>, String> {
    let s = state
        .config
        .lock()
        .map_err(|e| format!("config store lock poisoned: {e}"))?;
    Ok(s.user.clone())
}
