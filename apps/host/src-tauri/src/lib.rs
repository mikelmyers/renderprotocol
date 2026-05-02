pub mod audit;
pub mod bus;
pub mod carrier;
pub mod commands;
pub mod config_parser;
pub mod config_store;
pub mod config_watcher;
pub mod protocols;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Emitter, Manager};

use crate::audit::AuditLog;
use crate::bus::Bus;
use crate::carrier::PassthroughCarrier;
use crate::config_store::{ConfigKind, ConfigStore};
use crate::protocols::mcp::McpClient;

/// Shared state injected into every Tauri command via `State<'_, AppState>`.
/// Held as Arcs so background tasks can clone freely.
pub struct AppState {
    pub mcp: Arc<McpClient>,
    pub carrier: Arc<PassthroughCarrier>,
    pub bus: Arc<Bus>,
    pub config: Arc<ConfigStore>,
    pub audit: Arc<AuditLog>,
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
    let config = Arc::new(ConfigStore::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            // Audit log lives in Tauri's platform-appropriate app data
            // directory. Resolved at setup time because we need the
            // app handle for path resolution.
            let audit_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("audit.sqlite");
            tracing::info!(path = %audit_path.display(), "opening audit log");
            let audit = AuditLog::open(&audit_path)
                .unwrap_or_else(|e| {
                    tracing::error!(error = %e, "audit log open failed; aborting");
                    std::process::exit(1);
                });

            // Now that we have audit + the rest of the substrate, register
            // application state. Bus is created here so it can be wired
            // to the audit log in a single place.
            let bus = Bus::new(audit.clone());
            app.manage(AppState {
                mcp: mcp.clone(),
                carrier: carrier.clone(),
                bus: bus.clone(),
                config: config.clone(),
                audit: audit.clone(),
            });
            let handle = app.handle().clone();
            let mcp_for_init = mcp.clone();
            let endpoint_for_log = endpoint.clone();

            // ── MCP initialize + notifications listener ─────────────
            let endpoint_for_listener = endpoint.clone();
            let mcp_for_listener = mcp.clone();
            let handle_for_listener = handle.clone();
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
                            // Now that initialize is done, kick off the
                            // long-lived SSE listener for server-initiated
                            // notifications. It self-reconnects with
                            // backoff; no further coordination required.
                            protocols::mcp::notifications::spawn(
                                handle_for_listener.clone(),
                                mcp_for_listener.clone(),
                                endpoint_for_listener.clone(),
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

            // ── Config load + watch ─────────────────────────────────
            // For v0 the config dir resolves to `config/` relative to the
            // current working directory (the project root in `tauri dev`).
            // Production builds need a different resolver (app data dir
            // or a user-selected directory) — TODO when bundling lands.
            let config_dir = resolve_config_dir();
            let config_for_load = config.clone();
            let handle_for_load = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                load_initial_config(&config_dir, &config_for_load).await;
                let _ = handle_for_load.emit(
                    "config:ready",
                    serde_json::json!({ "dir": config_dir.display().to_string() }),
                );
            });

            let watcher_dir = resolve_config_dir();
            let watcher_handle = app.handle().clone();
            let watcher_store = config.clone();
            // We never tear the watcher down during the app's lifetime —
            // the OS reclaims when the process exits. RecommendedWatcher
            // isn't necessarily Sync (varies by platform), so rather
            // than wrapping it in a lock just to satisfy `manage`, we
            // leak it. Cheap, intentional, well-scoped.
            match config_watcher::spawn(watcher_handle, watcher_dir, watcher_store) {
                Ok(watcher) => {
                    let _ = Box::leak(Box::new(watcher));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "config watcher failed to start");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_read_resource,
            commands::bus::bus_emit,
            commands::config::config_snapshot,
            commands::config::config_set_active_agent,
            commands::audit::audit_query,
            commands::audit::audit_record,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn resolve_config_dir() -> PathBuf {
    if let Ok(env) = std::env::var("RENDERPROTOCOL_CONFIG_DIR") {
        return PathBuf::from(env);
    }
    // Walk up from CWD looking for a `config/` dir alongside `package.json`.
    // In `tauri dev` the CWD is `apps/host/src-tauri`; the config lives at
    // the repo root. Tolerate a few levels of nesting.
    if let Ok(cwd) = std::env::current_dir() {
        let mut probe = cwd.clone();
        for _ in 0..6 {
            let candidate = probe.join("config");
            let pkg = probe.join("package.json");
            if candidate.is_dir() && pkg.exists() {
                return candidate;
            }
            if !probe.pop() {
                break;
            }
        }
        // Fall back to CWD/config even if we didn't find the marker.
        return cwd.join("config");
    }
    PathBuf::from("config")
}

async fn load_initial_config(dir: &PathBuf, store: &ConfigStore) {
    let user_path = dir.join("user.md");
    if user_path.is_file() {
        if let Ok(text) = tokio::fs::read_to_string(&user_path).await {
            store.upsert(ConfigKind::User, "user", &text);
        }
    }
    let agents_dir = dir.join("agents");
    if agents_dir.is_dir() {
        if let Ok(mut entries) = tokio::fs::read_dir(&agents_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                if p.extension().and_then(|s| s.to_str()) != Some("md") {
                    continue;
                }
                let key = match p.file_stem().and_then(|s| s.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                if let Ok(text) = tokio::fs::read_to_string(&p).await {
                    store.upsert(ConfigKind::Agent, &key, &text);
                }
            }
        }
    }
}
