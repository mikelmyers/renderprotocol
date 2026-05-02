// Tauri commands for the audit log.
//
// `audit_query` is what the X-ray drawer calls to load the recent N
// events; `audit_record` lets the frontend push events into the same
// store (composition_assembled, action_decided, etc.) so the drawer is
// the single place to inspect the surface's history.

use serde_json::Value;
use tauri::State;

use crate::audit::{AuditEvent, NewEvent};
use crate::AppState;

#[tauri::command]
pub fn audit_query(
    state: State<'_, AppState>,
    limit: Option<u32>,
    since_id: Option<i64>,
    kind_prefix: Option<String>,
) -> Result<Vec<AuditEvent>, String> {
    state
        .audit
        .query_recent(
            limit.unwrap_or(200),
            since_id,
            kind_prefix.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audit_record(
    state: State<'_, AppState>,
    kind: String,
    payload: Option<Value>,
    parent_id: Option<i64>,
) -> Result<i64, String> {
    let id = state.audit.record(NewEvent {
        kind,
        payload: payload.unwrap_or(Value::Null),
        parent_id,
    });
    id.ok_or_else(|| "audit write failed".to_string())
}
