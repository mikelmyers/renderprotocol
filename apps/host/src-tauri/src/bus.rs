// Surface event bus — Rust side.
//
// Mirror of `apps/host/src/lib/surface-bus.ts`. The two are bridged via a
// single Tauri event channel ("surface-bus") and a Tauri command
// (`bus_emit`). Audit log writes happen inside `emit` so every bus
// event lands in the audit table with the same monotonic seq the
// frontend sees.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::audit::{AuditLog, NewEvent};

pub const EVENT_CHANNEL: &str = "surface-bus";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BusEvent {
    /// Primitive (or selectable sub-element) mounted.
    ElementRegistered {
        element_id: String,
        metadata: Value,
    },
    /// Same identity, fresh data. Distinct from a remove + register pair.
    ElementUpdated {
        element_id: String,
        metadata: Value,
    },
    ElementRemoved {
        element_id: String,
    },
    ElementSelected {
        element_id: String,
        source: SelectionSource,
    },
    ElementFocused {
        element_id: String,
    },
    /// A conversation message contains a `[ref:...]` token that resolves
    /// to this element_id.
    ReferenceInserted {
        element_id: String,
        message_id: String,
    },
    /// A reference chip was clicked. Frontend handles highlight + scroll;
    /// Rust records it for audit / replay.
    ReferenceResolved {
        element_id: String,
        target_mounted: bool,
    },
    /// Composition triggered, optionally anchored on an element.
    RecomposeRequested {
        intent: String,
        anchor: Option<String>,
        params: Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionSource {
    Click,
    Keyboard,
    ConversationReference,
    Programmatic,
}

#[derive(Debug, Clone, Serialize)]
pub struct BusEnvelope {
    pub seq: u64,
    pub ts_ms: i64,
    #[serde(flatten)]
    pub event: BusEvent,
}

pub struct Bus {
    seq: AtomicU64,
    audit: Arc<AuditLog>,
}

impl Bus {
    pub fn new(audit: Arc<AuditLog>) -> Arc<Self> {
        Arc::new(Self {
            seq: AtomicU64::new(0),
            audit,
        })
    }

    /// Stamp + emit. Writes to the audit log on the way out so every
    /// surface event is replayable. Audit failures are silent — surface
    /// behavior must not depend on audit success.
    pub fn emit(&self, app: &AppHandle, event: BusEvent) {
        let envelope = BusEnvelope {
            seq: self.seq.fetch_add(1, Ordering::SeqCst),
            ts_ms: now_ms(),
            event,
        };

        // Serialize once for both the wire and the audit row. The audit
        // payload is the full envelope (including seq) so replay is honest.
        match serde_json::to_value(&envelope) {
            Ok(payload) => {
                let kind = payload
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                self.audit.record(NewEvent::of(format!("bus.{}", kind), payload));
            }
            Err(e) => {
                tracing::warn!(error = %e, "failed to serialize bus envelope for audit");
            }
        }

        if let Err(e) = app.emit(EVENT_CHANNEL, &envelope) {
            tracing::warn!(error = %e, "failed to emit bus event");
        }
    }

    pub fn audit(&self) -> Arc<AuditLog> {
        self.audit.clone()
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// Convenience for callers that want to record without going through the
// bus envelope (e.g. notifications, tool calls).
#[allow(dead_code)]
pub fn record_kind(audit: &AuditLog, kind: &str, payload: Value) {
    audit.record(NewEvent::of(kind.to_string(), payload));
}

#[allow(dead_code)]
pub fn json_kv(pairs: &[(&str, Value)]) -> Value {
    let map: serde_json::Map<String, Value> =
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
    Value::Object(map)
}

#[allow(dead_code)]
pub fn quick(k: &str, v: impl Into<Value>) -> Value {
    json!({ k: v.into() })
}
