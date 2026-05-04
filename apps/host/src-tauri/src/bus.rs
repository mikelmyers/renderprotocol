// Surface event bus — Rust side.
//
// Mirror of `apps/host/src/lib/surface-bus.ts`. The two are bridged via a
// single Tauri event channel ("surface-bus") and a Tauri command
// (`bus_emit`) so the React side and the Rust side see the same
// monotonically-ordered stream.
//
// Why both sides at all: audit log writes happen in Rust (consolidated
// with tool calls), but the UI needs the same events to drive selection,
// reference chips, and recompositions. Dual-side store with a shared seq
// is the cleanest way to preserve causal ordering across the IPC boundary.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

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

#[derive(Default)]
pub struct Bus {
    seq: AtomicU64,
}

impl Bus {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { seq: AtomicU64::new(0) })
    }

    /// Stamp + emit. Single source of monotonic seq for both sides.
    pub fn emit(&self, app: &AppHandle, event: BusEvent) {
        let envelope = BusEnvelope {
            seq: self.seq.fetch_add(1, Ordering::SeqCst),
            ts_ms: chrono_ms(),
            event,
        };
        if let Err(e) = app.emit(EVENT_CHANNEL, &envelope) {
            tracing::warn!(error = %e, "failed to emit bus event");
        }
    }
}

fn chrono_ms() -> i64 {
    // Avoid pulling in `chrono` for one timestamp.
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
