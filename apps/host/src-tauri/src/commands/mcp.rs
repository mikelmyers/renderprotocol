// Tauri commands the React frontend invokes for MCP work.
// Every command routes through the carrier — even passthrough — so when
// ranking/discovery/federation arrive later there is no call-site rewrite.
//
// Audit writes happen here on both the request and the response path so
// the audit log carries a paired pre/post record per call. Failures are
// logged separately so the operator can see *what* failed and *why*
// from the X-ray drawer alone.

use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::audit::NewEvent;
use crate::AppState;

#[derive(Serialize)]
pub struct ToolCallResponse {
    pub raw: Value,
    pub structured: Option<Value>,
    pub text: Option<String>,
}

#[derive(Serialize)]
pub struct ResourceReadResponse {
    pub raw: Value,
    pub mime_type: Option<String>,
    pub text: Option<String>,
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
) -> Result<ToolCallResponse, String> {
    let started = Instant::now();
    let request_id = state.audit.record(NewEvent::of(
        "mcp.tool_call.request",
        json!({
            "tool": &name,
            "arguments": arguments.clone().unwrap_or(Value::Null),
        }),
    ));

    let result = state.carrier.call_tool(&name, arguments).await;

    let elapsed_ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok(r) => {
            state.audit.record(NewEvent {
                kind: "mcp.tool_call.response".into(),
                parent_id: request_id,
                payload: json!({
                    "tool": &name,
                    "ms": elapsed_ms,
                    "structured_present": r.structured.is_some(),
                    "text_len": r.text.as_ref().map(|t| t.len()).unwrap_or(0),
                }),
            });
        }
        Err(e) => {
            state.audit.record(NewEvent {
                kind: "mcp.tool_call.error".into(),
                parent_id: request_id,
                payload: json!({
                    "tool": &name,
                    "ms": elapsed_ms,
                    "error": e.to_string(),
                }),
            });
        }
    }

    let result = result.map_err(|e| e.to_string())?;
    Ok(ToolCallResponse {
        raw: result.raw,
        structured: result.structured,
        text: result.text,
    })
}

#[tauri::command]
pub async fn mcp_read_resource(
    state: State<'_, AppState>,
    uri: String,
) -> Result<ResourceReadResponse, String> {
    let started = Instant::now();
    let request_id = state.audit.record(NewEvent::of(
        "mcp.resource_read.request",
        json!({ "uri": &uri }),
    ));

    let result = state.carrier.read_resource(&uri).await;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok(r) => {
            state.audit.record(NewEvent {
                kind: "mcp.resource_read.response".into(),
                parent_id: request_id,
                payload: json!({
                    "uri": &uri,
                    "ms": elapsed_ms,
                    "mime_type": r.mime_type,
                    "text_len": r.text.as_ref().map(|t| t.len()).unwrap_or(0),
                }),
            });
        }
        Err(e) => {
            state.audit.record(NewEvent {
                kind: "mcp.resource_read.error".into(),
                parent_id: request_id,
                payload: json!({
                    "uri": &uri,
                    "ms": elapsed_ms,
                    "error": e.to_string(),
                }),
            });
        }
    }

    let result = result.map_err(|e| e.to_string())?;
    Ok(ResourceReadResponse {
        raw: result.raw,
        mime_type: result.mime_type,
        text: result.text,
    })
}
