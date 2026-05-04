// File-system watcher for the `config/` directory.
//
// Watches `agent.md` and `user.md` only, scoped to the resolved `config/`
// path — no recursive descent, no other paths. On modify/create/remove,
// re-reads the changed file, parses it, updates the in-process store, and
// emits a Tauri event to the frontend.
//
// Security: scope is intentionally narrow. The watcher does not list,
// read, or watch anything outside `config/`. The path is resolved once at
// startup and stored as a canonical absolute path so symlink games can't
// later redirect us elsewhere.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config_parser::{self, ParsedDocument};

#[derive(Default)]
pub struct ConfigStore {
    pub agent: Option<ParsedDocument>,
    pub user: Option<ParsedDocument>,
    /// Canonical absolute path; compared against canonicalized event paths
    /// so a symlink swap can't trick us into reading a different file.
    pub agent_path: PathBuf,
    pub user_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigUpdatedPayload {
    pub file: &'static str,
}

/// Resolve the `config/` directory. Override with the
/// `RENDERPROTOCOL_CONFIG_DIR` env var; otherwise resolves relative to the
/// `src-tauri/` crate at build time. The returned path is canonicalized so
/// the watcher comparisons stay symlink-safe.
pub fn resolve_config_dir() -> PathBuf {
    let raw = if let Ok(p) = std::env::var("RENDERPROTOCOL_CONFIG_DIR") {
        PathBuf::from(p)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("config")
    };
    raw.canonicalize().unwrap_or(raw)
}

/// Resolve where the carrier persists state (SQLite, key material).
/// Override with the `RENDERPROTOCOL_DATA_DIR` env var; otherwise lives
/// alongside `config/` as a sibling `data/` directory. v0 uses a single
/// SQLite file at `${data_dir}/carrier.db`.
pub fn resolve_data_dir() -> PathBuf {
    // Don't canonicalize — the directory may not exist yet on first
    // boot. The Storage layer creates it on open.
    if let Ok(p) = std::env::var("RENDERPROTOCOL_DATA_DIR") {
        PathBuf::from(p)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("data")
    }
}

/// Initial load + start the watcher. Returned RecommendedWatcher must be
/// held for the lifetime of the app — dropping it stops the watch.
pub fn start(
    config_dir: PathBuf,
    store: Arc<Mutex<ConfigStore>>,
    app: AppHandle,
) -> Result<RecommendedWatcher, String> {
    let agent_path = config_dir.join("agent.md");
    let user_path = config_dir.join("user.md");

    let agent_canon = agent_path.canonicalize().unwrap_or_else(|_| agent_path.clone());
    let user_canon = user_path.canonicalize().unwrap_or_else(|_| user_path.clone());

    {
        let mut s = store
            .lock()
            .map_err(|e| format!("config store lock poisoned: {e}"))?;
        s.agent_path = agent_canon.clone();
        s.user_path = user_canon.clone();
        if let Ok(c) = std::fs::read_to_string(&agent_path) {
            s.agent = Some(config_parser::parse(&c));
        } else {
            tracing::warn!(path = %agent_path.display(), "agent.md not readable at startup");
        }
        if let Ok(c) = std::fs::read_to_string(&user_path) {
            s.user = Some(config_parser::parse(&c));
        } else {
            tracing::warn!(path = %user_path.display(), "user.md not readable at startup");
        }
    }

    let store_handler = Arc::clone(&store);
    let app_handler = app.clone();

    let mut watcher: RecommendedWatcher = notify::recommended_watcher(
        move |res: Result<Event, notify::Error>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    tracing::warn!(error = %e, "config watcher event error");
                    return;
                }
            };

            // Access events are noise. Modify/Create/Remove cover the cases
            // editors produce when saving (atomic-rename, in-place rewrite,
            // delete-then-create). Anything else: ignore.
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
                _ => return,
            }

            for path in event.paths {
                let canon = path.canonicalize().unwrap_or_else(|_| path.clone());
                if let Err(e) = handle_changed(&canon, &store_handler, &app_handler) {
                    tracing::warn!(error = %e, path = %canon.display(), "config reload failed");
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&config_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    tracing::info!(dir = %config_dir.display(), "config watcher started");
    Ok(watcher)
}

fn handle_changed(
    canon_path: &std::path::Path,
    store: &Arc<Mutex<ConfigStore>>,
    app: &AppHandle,
) -> Result<(), String> {
    // Match against the canonical paths captured at startup. Any path
    // outside those two is dropped silently — defense-in-depth on top of
    // the non-recursive watch.
    let mut s = store
        .lock()
        .map_err(|e| format!("config store lock poisoned: {e}"))?;

    let (slot_is_agent, target_path) = if canon_path == s.agent_path {
        (true, s.agent_path.clone())
    } else if canon_path == s.user_path {
        (false, s.user_path.clone())
    } else {
        return Ok(());
    };

    let new_doc = match std::fs::read_to_string(&target_path) {
        Ok(c) => Some(config_parser::parse(&c)),
        Err(e) => {
            // File temporarily missing during atomic-rename save is normal;
            // a follow-up Create event lands the new content. Don't clear
            // the cache on a transient miss.
            tracing::debug!(error = %e, path = %target_path.display(), "config read miss; keeping last good");
            return Ok(());
        }
    };

    let changed = if slot_is_agent {
        doc_changed(&s.agent, &new_doc)
    } else {
        doc_changed(&s.user, &new_doc)
    };

    if !changed {
        return Ok(());
    }

    if slot_is_agent {
        s.agent = new_doc;
    } else {
        s.user = new_doc;
    }
    drop(s);

    let payload = ConfigUpdatedPayload {
        file: if slot_is_agent { "agent.md" } else { "user.md" },
    };
    let _ = app.emit("config:updated", payload);
    Ok(())
}

fn doc_changed(a: &Option<ParsedDocument>, b: &Option<ParsedDocument>) -> bool {
    match (a, b) {
        (None, None) => false,
        (Some(x), Some(y)) => x.body != y.body,
        _ => true,
    }
}
