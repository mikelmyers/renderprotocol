// Tauri commands the React frontend invokes for MCP work.
// Every command routes through the carrier — even passthrough — so when
// ranking/discovery/federation arrive later there is no call-site rewrite.

use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

use crate::carrier::{CarrierStatus, RoutedResourceResult, RoutedToolCallResult};
use crate::AppState;

/// Connection state of an MCP client (one per hosting agent). Shared
/// between init tasks (writers) and `mcp_status` / `carrier_status`
/// (readers) so a frontend that mounts after `agent:ready` already fired
/// can still learn the current state.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum McpConnectionState {
    Connecting,
    Ready,
    Error { message: String },
}

pub type McpConnectionHandle = Arc<RwLock<McpConnectionState>>;

pub fn new_connection_handle() -> McpConnectionHandle {
    Arc::new(RwLock::new(McpConnectionState::Connecting))
}

#[tauri::command]
pub async fn mcp_list_tools(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .carrier
        .list_tools()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, AppState>,
    name: String,
    arguments: Option<Value>,
) -> Result<RoutedToolCallResult, String> {
    state
        .carrier
        .call_tool(&name, arguments)
        .await
        .map_err(|e| e.to_string())
}

/// Hard cap on the size of any single text-content field returned by
/// resources/read. A hostile or buggy hosting agent shouldn't be able to
/// OOM the host with a giant document. v0 enforces post-parse; a future
/// hard cap at the HTTP transport level lands when streaming reads are
/// wired in. 1 MiB is generous for typical UI resource HTML.
const MAX_RESOURCE_TEXT_BYTES: usize = 1_048_576;

#[tauri::command]
pub async fn mcp_read_resource(
    state: State<'_, AppState>,
    uri: String,
) -> Result<RoutedResourceResult, String> {
    let routed = state
        .carrier
        .read_resource(&uri)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(arr) = routed.response.get("contents").and_then(Value::as_array) {
        for item in arr {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                if text.len() > MAX_RESOURCE_TEXT_BYTES {
                    return Err(format!(
                        "resource content exceeds size cap ({} > {} bytes) from agent {}",
                        text.len(),
                        MAX_RESOURCE_TEXT_BYTES,
                        routed.served_by,
                    ));
                }
            }
        }
    }

    Ok(routed)
}

#[tauri::command]
pub fn mcp_status(state: State<'_, AppState>) -> McpConnectionState {
    // v0: binary aggregate — connected if any hosting agent is ready.
    // The richer per-agent view lives in carrier_status.
    if state.carrier.any_ready() {
        McpConnectionState::Ready
    } else {
        McpConnectionState::Connecting
    }
}

#[tauri::command]
pub fn carrier_status(state: State<'_, AppState>) -> CarrierStatus {
    state.carrier.status()
}
