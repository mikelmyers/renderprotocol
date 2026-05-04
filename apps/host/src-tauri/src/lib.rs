pub mod bus;
pub mod carrier;
pub mod commands;
pub mod config_parser;
pub mod config_watcher;
pub mod protocols;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use crate::bus::Bus;
use crate::carrier::payments::{PaymentBackend, StubBackend};
use crate::carrier::registry::{self, HostingAgentSpec};
use crate::carrier::storage::Storage;
use crate::carrier::RoutingCarrier;
use crate::config_watcher::ConfigStore;

/// Shared state injected into every Tauri command via `State<'_, AppState>`.
/// Held as Arcs so background tasks can clone freely.
pub struct AppState {
    pub carrier: Arc<RoutingCarrier>,
    pub bus: Arc<Bus>,
    /// In-process store of parsed agent.md / user.md. Updated by the file
    /// watcher; read by Tauri commands.
    pub config: Arc<Mutex<ConfigStore>>,
}

/// Newtype owning the file-watcher for the app's lifetime. Held via
/// Tauri's managed-state container so the watcher's destructor only runs
/// at app shutdown.
struct WatcherSlot(#[allow(dead_code)] notify::RecommendedWatcher);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let bus = Bus::new();
    let config = Arc::new(Mutex::new(ConfigStore::default()));

    // Resolve the registry of hosting agents the carrier should connect
    // to. config/hosting-agents.md is the source of truth; if it's missing
    // we fall back to the historical single-mock default so a fresh
    // checkout still boots into something.
    let agent_specs = load_agent_specs();
    if agent_specs.is_empty() {
        tracing::warn!("no hosting agents configured; carrier will have nothing to route to");
    }

    // 5c: open the persistent SQLite store and hydrate the carrier from
    // it. If anything fails (path unwritable, schema mismatch), fall
    // back to ephemeral in-memory storage so the demo still boots —
    // restart-survival is a feature degradation, not a hard
    // requirement.
    let data_dir = config_watcher::resolve_data_dir();
    let db_path = data_dir.join("carrier.db");
    let storage = match Storage::open(&db_path) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            tracing::warn!(
                error = %e,
                path = %db_path.display(),
                "carrier storage unavailable; falling back to ephemeral in-memory store"
            );
            Arc::new(
                Storage::open_in_memory_for_runtime()
                    .expect("in-memory SQLite should always succeed"),
            )
        }
    };
    let payments: Arc<dyn PaymentBackend> = Arc::new(StubBackend::new());
    let carrier = match RoutingCarrier::with_storage(
        agent_specs.clone(),
        Arc::clone(&storage),
        Arc::clone(&payments),
    ) {
        Ok(c) => Arc::new(c),
        Err(e) => {
            tracing::warn!(error = %e, "carrier construction with storage failed; falling back");
            Arc::new(RoutingCarrier::new(agent_specs))
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            carrier: Arc::clone(&carrier),
            bus,
            config: Arc::clone(&config),
        })
        .setup(move |app| {
            let app_for_carrier = app.handle().clone();
            // The carrier owns its own per-agent init lifecycle (retry,
            // catalog refresh, ready/error events). We just hand it the
            // app handle for emitting events.
            carrier.spawn_init_tasks(app_for_carrier);

            // Also fire mcp:error if every agent eventually fails. For
            // v0 simplicity we let per-agent agent:error events serve the
            // diagnostic role; mcp:error stays for legacy "totally
            // unreachable" UX hooks but isn't synthesized aggregate-wise
            // here. Add when there's a UI that needs it.
            let _ = app.handle().emit("carrier:configured", ());

            // Resolve config dir, initial-load + start the watcher. If the
            // dir is missing (fresh checkout), log and continue — the
            // surface still works without it; commands will return None.
            let config_dir = config_watcher::resolve_config_dir();
            if config_dir.is_dir() {
                let app_for_watcher = app.handle().clone();
                let store_for_watcher = Arc::clone(&config);
                match config_watcher::start(config_dir.clone(), store_for_watcher, app_for_watcher) {
                    Ok(w) => {
                        app.manage(WatcherSlot(w));
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, dir = %config_dir.display(), "config watcher failed to start");
                    }
                }
            } else {
                tracing::warn!(dir = %config_dir.display(), "config directory not found; skipping watcher");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_read_resource,
            commands::mcp::mcp_status,
            commands::mcp::carrier_status,
            commands::mcp::carrier_admin_vouch,
            commands::mcp::carrier_admin_revoke_vouch,
            commands::mcp::carrier_admin_forfeit,
            commands::mcp::acp_checkout,
            commands::bus::bus_emit,
            commands::config::current_agent_md,
            commands::config::current_user_md,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Load the registry from config/hosting-agents.md, applying the same
/// path-resolution rules (env override + CARGO_MANIFEST_DIR-relative
/// default) as the config watcher.
fn load_agent_specs() -> Vec<HostingAgentSpec> {
    let config_dir = config_watcher::resolve_config_dir();
    let path = config_dir.join("hosting-agents.md");
    match registry::load_from_path(&path) {
        Ok(v) if !v.is_empty() => {
            tracing::info!(path = %path.display(), count = v.len(), "loaded hosting agents");
            v
        }
        Ok(_) => {
            tracing::warn!(path = %path.display(), "hosting-agents.md present but empty; using built-in default");
            default_specs()
        }
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "hosting-agents.md missing or unreadable; using built-in default");
            default_specs()
        }
    }
}

fn default_specs() -> Vec<HostingAgentSpec> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    vec![HostingAgentSpec {
        id: "alpha".to_string(),
        endpoint: "http://127.0.0.1:4717/mcp".to_string(),
        description: Some("Built-in default; override via config/hosting-agents.md".to_string()),
        bond_amount: 0,
        onboarded_at_ms: now_ms,
        // Built-in default is the v0 anchor — bootstrap kernel member.
        seed: true,
        price_per_call_cents: 0,
        carrier_take_rate_bps: 100,
        merchant_account_id: String::new(),
    }]
}
