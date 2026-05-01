pub mod bus;
pub mod carrier;
pub mod commands;
pub mod protocols;

use std::sync::Arc;

use tauri::Emitter;

use crate::bus::Bus;
use crate::carrier::PassthroughCarrier;
use crate::protocols::mcp::McpClient;

/// Shared state injected into every Tauri command via `State<'_, AppState>`.
/// Held as Arcs so background tasks can clone freely.
pub struct AppState {
    pub mcp: Arc<McpClient>,
    pub carrier: Arc<PassthroughCarrier>,
    pub bus: Arc<Bus>,
}

const DEFAULT_MCP_ENDPOINT: &str = "http://127.0.0.1:4717/mcp";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let endpoint = std::env::var("RENDERPROTOCOL_MCP_ENDPOINT")
        .unwrap_or_else(|_| DEFAULT_MCP_ENDPOINT.to_string());

    let mcp = Arc::new(McpClient::new(endpoint.clone()));
    let carrier = Arc::new(PassthroughCarrier::new(mcp.clone()));
    let bus = Bus::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            mcp: mcp.clone(),
            carrier,
            bus,
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let mcp_for_init = mcp.clone();
            let endpoint_for_log = endpoint.clone();

            // Best-effort initialize at boot. The mock server may still be
            // starting (scripts/dev.sh launches both in parallel); retry
            // briefly. Final failure surfaces to the frontend via an event.
            tauri::async_runtime::spawn(async move {
                tracing::info!(endpoint = %endpoint_for_log, "initializing MCP client");
                let mut attempts = 0u32;
                loop {
                    attempts += 1;
                    match mcp_for_init.initialize().await {
                        Ok(_) => {
                            tracing::info!(
                                session = ?mcp_for_init.session_id(),
                                "MCP initialized"
                            );
                            let _ = handle.emit(
                                "mcp:ready",
                                serde_json::json!({ "session": mcp_for_init.session_id() }),
                            );
                            break;
                        }
                        Err(e) if attempts < 20 => {
                            tracing::debug!(error = %e, attempt = attempts, "MCP initialize retry");
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        }
                        Err(e) => {
                            tracing::error!(error = %e, "MCP initialize gave up");
                            let _ = handle.emit(
                                "mcp:error",
                                serde_json::json!({ "error": e.to_string() }),
                            );
                            break;
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::bus::bus_emit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
