// Audit log. Single source of truth for "what happened, when, in what
// order" — every tool call, resource read, bus event, notification,
// config change, and frontend-emitted composition event lands here.
//
// Stored in SQLite (rusqlite, bundled) inside Tauri's app data directory.
// Single `events` table with parent_id support so causal chains can be
// reconstructed when we need them. v0 reads are flat reverse-chronological
// queries; richer replay arrives when the X-ray drawer's frame view does.

pub mod store;

pub use store::{AuditEvent, AuditLog, NewEvent};
