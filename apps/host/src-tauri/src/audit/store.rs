use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// Single events table. Every audit-eligible signal flows through here.
//
// Schema rationale:
//   - id is the natural ordering key inside a process. Combined with
//     ts_ms, that's enough for chronological replay.
//   - kind is a snake_case string ("tool_call", "bus.element_selected",
//     "notification.resources_updated", etc.). Not constrained — adding a
//     new kind is a one-line change at the call site.
//   - parent_id supports causal chains (composition → tool calls →
//     responses) but is null in v0 for events that aren't part of a
//     deliberate frame. The X-ray drawer can already read flat; richer
//     parent rendering arrives when needed.
//   - payload is JSON text. Keeping the schema flat means new kinds
//     don't require migrations.

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,
  parent_id INTEGER REFERENCES events(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms);
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: i64,
    pub ts_ms: i64,
    pub parent_id: Option<i64>,
    pub kind: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct NewEvent {
    pub kind: String,
    pub payload: Value,
    pub parent_id: Option<i64>,
}

impl NewEvent {
    pub fn of(kind: impl Into<String>, payload: Value) -> Self {
        Self {
            kind: kind.into(),
            payload,
            parent_id: None,
        }
    }
}

pub struct AuditLog {
    conn: Mutex<Connection>,
}

impl AuditLog {
    pub fn open(path: &Path) -> rusqlite::Result<Arc<Self>> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        // WAL gives us concurrent reads while a write is in flight,
        // which matters once the X-ray drawer queries while events
        // are landing in real time.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Arc::new(Self {
            conn: Mutex::new(conn),
        }))
    }

    /// Best-effort write. Failures are logged but don't propagate — an
    /// audit miss should never crash the surface.
    pub fn record(&self, ev: NewEvent) -> Option<i64> {
        let ts = now_ms();
        let payload_text = serde_json::to_string(&ev.payload).unwrap_or_else(|_| "{}".into());
        let result = {
            let conn = self.conn.lock();
            conn.execute(
                "INSERT INTO events (ts_ms, parent_id, kind, payload) VALUES (?1, ?2, ?3, ?4)",
                params![ts, ev.parent_id, ev.kind, payload_text],
            )
            .map(|_| conn.last_insert_rowid())
        };
        match result {
            Ok(id) => Some(id),
            Err(e) => {
                tracing::warn!(error = %e, kind = %ev.kind, "audit write failed");
                None
            }
        }
    }

    /// Reverse-chronological query, capped. `since_id`, when set, returns
    /// only events strictly newer than that id — used by the X-ray
    /// drawer's tail mode.
    pub fn query_recent(
        &self,
        limit: u32,
        since_id: Option<i64>,
        kind_filter: Option<&str>,
    ) -> rusqlite::Result<Vec<AuditEvent>> {
        let conn = self.conn.lock();
        let limit = limit.min(2000);
        let mut sql = String::from(
            "SELECT id, ts_ms, parent_id, kind, payload FROM events WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(since) = since_id {
            sql.push_str(" AND id > ?");
            args.push(Box::new(since));
        }
        if let Some(k) = kind_filter {
            sql.push_str(" AND kind LIKE ?");
            args.push(Box::new(format!("{}%", k)));
        }
        sql.push_str(" ORDER BY id DESC LIMIT ?");
        args.push(Box::new(limit as i64));

        let arg_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(arg_refs.as_slice(), |row| {
            let payload_text: String = row.get(4)?;
            let payload = serde_json::from_str::<Value>(&payload_text).unwrap_or(Value::Null);
            Ok(AuditEvent {
                id: row.get(0)?,
                ts_ms: row.get(1)?,
                parent_id: row.get(2)?,
                kind: row.get(3)?,
                payload,
            })
        })?;
        rows.collect()
    }

    /// Used during testing — clears all events.
    #[allow(dead_code)]
    pub fn clear(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM events", [])?;
        Ok(())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
