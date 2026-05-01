// Tauri commands the React frontend invokes for MCP work.
// Every command routes through the carrier — even passthrough — so when
// ranking/discovery/federation arrive later there is no call-site rewrite.

use serde::Serialize;
use serde_json::Value;
use tauri::State;

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
    let result = state
        .carrier
        .call_tool(&name, arguments)
        .await
        .map_err(|e| e.to_string())?;
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
    let result = state
        .carrier
        .read_resource(&uri)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ResourceReadResponse {
        raw: result.raw,
        mime_type: result.mime_type,
        text: result.text,
    })
}
