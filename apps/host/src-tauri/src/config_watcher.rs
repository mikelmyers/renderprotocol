// Cross-platform file watcher for the configuration substrate.
//
// Watches the `config/` directory recursively and emits a
// `config:changed` Tauri event whenever a `.md` file under it is created,
// modified, removed, or renamed. The frontend reloads the relevant slice
// on each change.
//
// Debouncing is local — editors save in multiple steps (tmp write →
// rename) and we don't want to fan out three "changed" events per
// keystroke. The watcher coalesces bursts inside a 250ms window.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use crate::audit::NewEvent;
use crate::config_store::{ConfigKind, ConfigStore};
use crate::AppState;

const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
pub struct ConfigChangedEvent {
    pub kind: ConfigKind,
    pub key: String,
    pub action: ConfigChangeAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigChangeAction {
    Reloaded,
    Removed,
}

/// Spawn the watcher. Returns immediately; the watcher lives for the
/// lifetime of the app via the returned guard (move it into AppState
/// or leak it — Tauri's setup hook does the latter implicitly).
pub fn spawn(
    app: AppHandle,
    config_dir: PathBuf,
    store: Arc<ConfigStore>,
) -> notify::Result<RecommendedWatcher> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Event>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })?;
    watcher.watch(&config_dir, RecursiveMode::Recursive)?;

    let pending: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let last_burst: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

    // Receiver loop — collects events into a debounce buffer and flushes
    // after the burst settles.
    let pending_clone = pending.clone();
    let last_burst_clone = last_burst.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if !is_md_event(&event) {
                continue;
            }
            for p in event.paths.iter() {
                if path_is_md(p) {
                    pending_clone.lock().push(p.clone());
                }
            }
            *last_burst_clone.lock() = Some(Instant::now());
        }
    });

    // Flush loop — wakes periodically; if a burst has settled, processes.
    let app_for_flush = app.clone();
    let store_for_flush = store.clone();
    let config_dir_for_flush = config_dir.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(DEBOUNCE).await;
            let should_flush = {
                let last = last_burst.lock();
                match *last {
                    Some(t) if t.elapsed() >= DEBOUNCE => true,
                    _ => false,
                }
            };
            if !should_flush {
                continue;
            }
            *last_burst.lock() = None;
            let paths: Vec<PathBuf> = {
                let mut p = pending.lock();
                std::mem::take(&mut *p)
            };
            // De-dupe paths — same file edited multiple times in the burst.
            let mut unique: Vec<PathBuf> = Vec::new();
            for p in paths {
                if !unique.iter().any(|q| q == &p) {
                    unique.push(p);
                }
            }
            for path in unique {
                handle_path(&app_for_flush, &store_for_flush, &config_dir_for_flush, &path).await;
            }
        }
    });

    Ok(watcher)
}

async fn handle_path(
    app: &AppHandle,
    store: &ConfigStore,
    config_dir: &Path,
    path: &Path,
) {
    let Some((kind, key)) = classify(config_dir, path) else {
        return;
    };
    if path.exists() {
        match tokio::fs::read_to_string(path).await {
            Ok(text) => {
                store.upsert(kind.clone(), &key, &text);
                audit(app, "config.reloaded", json!({
                    "kind": kind_str(&kind),
                    "key": &key,
                    "bytes": text.len(),
                }));
                let _ = app.emit(
                    "config:changed",
                    ConfigChangedEvent {
                        kind,
                        key,
                        action: ConfigChangeAction::Reloaded,
                    },
                );
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "failed to read config file");
            }
        }
    } else {
        store.remove(&kind, &key);
        audit(app, "config.removed", json!({
            "kind": kind_str(&kind),
            "key": &key,
        }));
        let _ = app.emit(
            "config:changed",
            ConfigChangedEvent {
                kind,
                key,
                action: ConfigChangeAction::Removed,
            },
        );
    }
}

fn kind_str(kind: &ConfigKind) -> &'static str {
    match kind {
        ConfigKind::User => "user",
        ConfigKind::Agent => "agent",
    }
}

fn audit(app: &AppHandle, kind: &str, payload: serde_json::Value) {
    if let Some(state) = app.try_state::<AppState>() {
        state.audit.record(NewEvent::of(kind.to_string(), payload));
    }
}

fn classify(config_dir: &Path, path: &Path) -> Option<(ConfigKind, String)> {
    let rel = path.strip_prefix(config_dir).ok()?;
    let mut comps = rel.components();
    let first = comps.next()?.as_os_str().to_str()?.to_string();
    let stem = path.file_stem()?.to_str()?.to_string();
    if first == "user.md" {
        return Some((ConfigKind::User, "user".to_string()));
    }
    if first == "agents" {
        return Some((ConfigKind::Agent, stem));
    }
    None
}

fn is_md_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

fn path_is_md(p: &Path) -> bool {
    matches!(p.extension().and_then(|s| s.to_str()), Some("md"))
}
