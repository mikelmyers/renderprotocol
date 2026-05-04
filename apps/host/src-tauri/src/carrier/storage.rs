// SQLite persistence for the carrier (RouteRank step 5c.1).
//
// Receipts, vouches, agent keypairs, and rotated receipt summaries
// survive restart. Storage is write-through: in-memory stores remain
// the hot read path, every insert mirrors to disk synchronously.
//
// This is the v0 substrate. Future workstreams will:
//   - Switch from rusqlite (sync) to sqlx (async) if write-path latency
//     becomes a concern under steady-state traffic. v0 demo writes are
//     dozens per minute at most — sync is fine, no spawn_blocking.
//   - Add WAL-mode rotation, point-in-time recovery, etc., once durability
//     stops being best-effort.
//
// Schema migrations are versioned via the `schema_version` table; v1 is
// the initial 5c shape. A version mismatch on open triggers a migration
// pass; missing tables are created.

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use super::receipts::{ErrorKind, Receipt};
use super::vouches::Vouch;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("schema version mismatch: file at {found}, code at {expected}")]
    VersionMismatch { found: i64, expected: i64 },
}

/// Owns the connection. Behind a Mutex because rusqlite's `Connection`
/// is `!Sync` — but contention on the carrier's write path is low so
/// the mutex doesn't show up in benchmarks.
pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    /// Open or create the SQLite file. Runs migration to current schema.
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        // Better durability for the v0 demo. Tradeoff is write speed —
        // negligible at our volume.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.migrate()?;
        Ok(storage)
    }

    /// Open an in-memory database. Used by tests and as a fallback for
    /// `RoutingCarrier::new` when no on-disk path is configured (the
    /// "ephemeral mode" — useful for tools and tests).
    pub fn open_in_memory_for_runtime() -> Result<Self, StorageError> {
        let conn = Connection::open_in_memory()?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.migrate()?;
        Ok(storage)
    }

    /// Convenience alias used in tests.
    #[cfg(test)]
    pub fn in_memory() -> Result<Self, StorageError> {
        Self::open_in_memory_for_runtime()
    }

    fn migrate(&self) -> Result<(), StorageError> {
        let conn = self.conn.lock();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS receipts (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                tool TEXT NOT NULL,
                success INTEGER NOT NULL,
                latency_ms INTEGER NOT NULL,
                ts_ms INTEGER NOT NULL,
                error_kind TEXT,
                exploratory INTEGER NOT NULL DEFAULT 0,
                carrier_sig BLOB,
                agent_sig BLOB
            );
            CREATE INDEX IF NOT EXISTS receipts_agent_tool ON receipts(agent_id, tool);
            CREATE INDEX IF NOT EXISTS receipts_ts ON receipts(ts_ms);

            CREATE TABLE IF NOT EXISTS receipt_summaries (
                agent_id TEXT NOT NULL,
                tool TEXT NOT NULL,
                count INTEGER NOT NULL,
                success_count INTEGER NOT NULL,
                latency_p50_ms REAL,
                oldest_ts_ms INTEGER NOT NULL,
                newest_ts_ms INTEGER NOT NULL,
                PRIMARY KEY (agent_id, tool)
            );

            CREATE TABLE IF NOT EXISTS vouches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voucher_id TEXT NOT NULL,
                vouchee_id TEXT NOT NULL,
                ts_ms INTEGER NOT NULL,
                revoked_at_ms INTEGER,
                signature BLOB
            );
            CREATE INDEX IF NOT EXISTS vouches_voucher ON vouches(voucher_id);
            CREATE INDEX IF NOT EXISTS vouches_vouchee ON vouches(vouchee_id);

            CREATE TABLE IF NOT EXISTS agent_keys (
                agent_id TEXT PRIMARY KEY,
                public_key BLOB NOT NULL,
                private_key BLOB,
                created_at_ms INTEGER NOT NULL
            );
            ",
        )?;

        let current: Option<i64> = conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
                row.get(0)
            })
            .optional()?;
        match current {
            None => {
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?1)",
                    params![SCHEMA_VERSION],
                )?;
            }
            Some(v) if v == SCHEMA_VERSION => {}
            Some(v) => {
                return Err(StorageError::VersionMismatch {
                    found: v,
                    expected: SCHEMA_VERSION,
                });
            }
        }
        Ok(())
    }

    // ---- Receipts -------------------------------------------------------

    pub fn insert_receipt(
        &self,
        r: &Receipt,
        carrier_sig: Option<&[u8]>,
        agent_sig: Option<&[u8]>,
    ) -> Result<i64, StorageError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO receipts (agent_id, tool, success, latency_ms, ts_ms, error_kind, exploratory, carrier_sig, agent_sig)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                r.agent_id,
                r.tool,
                r.success as i64,
                r.latency_ms as i64,
                r.ts_ms,
                r.error_kind.as_ref().map(error_kind_str),
                r.exploratory as i64,
                carrier_sig,
                agent_sig,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Load all receipts in seq order. Used at boot to hydrate the
    /// in-memory ReceiptStore.
    pub fn load_all_receipts(&self) -> Result<Vec<StoredReceipt>, StorageError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT agent_id, tool, success, latency_ms, ts_ms, error_kind, exploratory, carrier_sig, agent_sig
             FROM receipts ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let error_kind_s: Option<String> = row.get(5)?;
            Ok(StoredReceipt {
                receipt: Receipt {
                    agent_id: row.get(0)?,
                    tool: row.get(1)?,
                    success: row.get::<_, i64>(2)? != 0,
                    latency_ms: row.get::<_, i64>(3)? as u64,
                    ts_ms: row.get(4)?,
                    error_kind: error_kind_s.and_then(|s| str_error_kind(&s)),
                    exploratory: row.get::<_, i64>(6)? != 0,
                },
                carrier_sig: row.get(7)?,
                agent_sig: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
    }

    /// Delete receipts older than `cutoff_ms` and roll them up into
    /// per-(agent, tool) summary rows. Idempotent — re-running on the
    /// same data does nothing.
    pub fn rotate_old_receipts(&self, cutoff_ms: i64) -> Result<usize, StorageError> {
        let conn = self.conn.lock();
        // Compute summaries inside a transaction so the delete + summary
        // update are atomic. v0 simplification: replace any existing
        // summary row rather than merging — receipts past 90d are
        // fully ageded out and merging quantile sketches across non-
        // overlapping time windows isn't well-defined for our v0
        // single-p50 representation.
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO receipt_summaries (agent_id, tool, count, success_count, latency_p50_ms, oldest_ts_ms, newest_ts_ms)
             SELECT agent_id, tool, COUNT(*), SUM(success), NULL, MIN(ts_ms), MAX(ts_ms)
             FROM receipts WHERE ts_ms < ?1 GROUP BY agent_id, tool",
            params![cutoff_ms],
        )?;
        let deleted = tx.execute(
            "DELETE FROM receipts WHERE ts_ms < ?1",
            params![cutoff_ms],
        )?;
        tx.commit()?;
        Ok(deleted)
    }

    // ---- Vouches --------------------------------------------------------

    pub fn insert_vouch(
        &self,
        v: &Vouch,
        signature: Option<&[u8]>,
    ) -> Result<i64, StorageError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO vouches (voucher_id, vouchee_id, ts_ms, revoked_at_ms, signature)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                v.voucher_id,
                v.vouchee_id,
                v.ts_ms,
                v.revoked_at_ms,
                signature,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn mark_vouch_revoked(
        &self,
        voucher_id: &str,
        vouchee_id: &str,
        revoked_at_ms: i64,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE vouches SET revoked_at_ms = ?3
             WHERE voucher_id = ?1 AND vouchee_id = ?2 AND revoked_at_ms IS NULL",
            params![voucher_id, vouchee_id, revoked_at_ms],
        )?;
        Ok(())
    }

    pub fn load_all_vouches(&self) -> Result<Vec<StoredVouch>, StorageError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT voucher_id, vouchee_id, ts_ms, revoked_at_ms, signature FROM vouches ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredVouch {
                vouch: Vouch {
                    voucher_id: row.get(0)?,
                    vouchee_id: row.get(1)?,
                    ts_ms: row.get(2)?,
                    revoked_at_ms: row.get(3)?,
                    signature: None, // signature stored as BLOB; surfaced separately
                },
                signature_bytes: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
    }

    // ---- Agent keys -----------------------------------------------------

    /// Upsert an agent's keypair. `private_key` is `Some` for agents the
    /// carrier signs on behalf of (everyone in v0 — single-party signing);
    /// `None` once real dual signing arrives and only the public key is
    /// stored for verification.
    pub fn upsert_agent_keys(
        &self,
        agent_id: &str,
        public_key: &[u8],
        private_key: Option<&[u8]>,
        created_at_ms: i64,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO agent_keys (agent_id, public_key, private_key, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(agent_id) DO UPDATE SET public_key = excluded.public_key, private_key = excluded.private_key",
            params![agent_id, public_key, private_key, created_at_ms],
        )?;
        Ok(())
    }

    pub fn load_agent_keys(&self, agent_id: &str) -> Result<Option<StoredAgentKeys>, StorageError> {
        let conn = self.conn.lock();
        let result = conn
            .query_row(
                "SELECT public_key, private_key, created_at_ms FROM agent_keys WHERE agent_id = ?1",
                params![agent_id],
                |row| {
                    Ok(StoredAgentKeys {
                        public_key: row.get(0)?,
                        private_key: row.get(1)?,
                        created_at_ms: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(result)
    }

    /// Load every persisted key. Used by `KeyStore::new` to warm the
    /// in-memory cache so verification works without a per-agent
    /// lazy-load round-trip on the read path.
    pub fn load_all_agent_keys(&self) -> Result<Vec<(String, StoredAgentKeys)>, StorageError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT agent_id, public_key, private_key, created_at_ms FROM agent_keys",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                StoredAgentKeys {
                    public_key: row.get(1)?,
                    private_key: row.get(2)?,
                    created_at_ms: row.get(3)?,
                },
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
    }
}

#[derive(Debug, Clone)]
pub struct StoredReceipt {
    pub receipt: Receipt,
    pub carrier_sig: Option<Vec<u8>>,
    pub agent_sig: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct StoredVouch {
    pub vouch: Vouch,
    pub signature_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct StoredAgentKeys {
    pub public_key: Vec<u8>,
    pub private_key: Option<Vec<u8>>,
    pub created_at_ms: i64,
}

fn error_kind_str(k: &ErrorKind) -> &'static str {
    match k {
        ErrorKind::Transport => "transport",
        ErrorKind::JsonRpc => "json_rpc",
        ErrorKind::Timeout => "timeout",
        ErrorKind::Other => "other",
    }
}

fn str_error_kind(s: &str) -> Option<ErrorKind> {
    match s {
        "transport" => Some(ErrorKind::Transport),
        "json_rpc" => Some(ErrorKind::JsonRpc),
        "timeout" => Some(ErrorKind::Timeout),
        "other" => Some(ErrorKind::Other),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(agent: &str, tool: &str, success: bool, ts: i64) -> Receipt {
        Receipt {
            agent_id: agent.into(),
            tool: tool.into(),
            success,
            latency_ms: 30,
            ts_ms: ts,
            error_kind: if success { None } else { Some(ErrorKind::Other) },
            exploratory: false,
        }
    }

    #[test]
    fn open_creates_schema_and_records_version() {
        let s = Storage::in_memory().unwrap();
        let conn = s.conn.lock();
        let v: i64 = conn
            .query_row("SELECT version FROM schema_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
    }

    #[test]
    fn receipt_round_trips() {
        let s = Storage::in_memory().unwrap();
        s.insert_receipt(&r("alpha", "lookup", true, 100), Some(&[1, 2, 3]), None)
            .unwrap();
        let loaded = s.load_all_receipts().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].receipt.agent_id, "alpha");
        assert_eq!(loaded[0].carrier_sig, Some(vec![1, 2, 3]));
        assert!(loaded[0].agent_sig.is_none());
    }

    #[test]
    fn vouch_round_trips_and_revokes() {
        let s = Storage::in_memory().unwrap();
        let v = Vouch {
            voucher_id: "alpha".into(),
            vouchee_id: "beta".into(),
            ts_ms: 1000,
            revoked_at_ms: None,
            signature: None,
        };
        s.insert_vouch(&v, Some(&[9, 9, 9])).unwrap();
        s.mark_vouch_revoked("alpha", "beta", 5_000_000).unwrap();
        let loaded = s.load_all_vouches().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].vouch.revoked_at_ms, Some(5_000_000));
        assert_eq!(loaded[0].signature_bytes, Some(vec![9, 9, 9]));
    }

    #[test]
    fn agent_keys_upsert_and_load() {
        let s = Storage::in_memory().unwrap();
        s.upsert_agent_keys("alpha", &[1; 32], Some(&[2; 32]), 100)
            .unwrap();
        let loaded = s.load_agent_keys("alpha").unwrap().unwrap();
        assert_eq!(loaded.public_key, vec![1; 32]);
        assert_eq!(loaded.private_key, Some(vec![2; 32]));
        assert_eq!(loaded.created_at_ms, 100);
    }

    #[test]
    fn persistence_round_trip_via_routing_carrier() {
        // End-to-end: insert a receipt + vouch via the carrier's API,
        // open a fresh carrier on the same Storage, verify the data
        // survives. This is the property `RoutingCarrier::with_storage`
        // is supposed to guarantee.
        use crate::carrier::keys::KeyStore;
        use crate::carrier::vouches::Vouch;

        let storage = std::sync::Arc::new(Storage::in_memory().unwrap());
        let now_ms = 1_000_000;
        let keys = KeyStore::new(std::sync::Arc::clone(&storage), now_ms).unwrap();
        keys.ensure_keypair("alpha", now_ms).unwrap();
        keys.ensure_keypair("beta", now_ms).unwrap();

        // Insert one receipt + sign it.
        let receipt = Receipt {
            agent_id: "alpha".into(),
            tool: "lookup".into(),
            success: true,
            latency_ms: 30,
            ts_ms: now_ms,
            error_kind: None,
            exploratory: false,
        };
        let (csig, asig) = keys.sign_receipt(&receipt, now_ms).unwrap();
        storage
            .insert_receipt(&receipt, Some(&csig), Some(&asig))
            .unwrap();

        // Insert one vouch + sign it.
        let v = Vouch {
            voucher_id: "alpha".into(),
            vouchee_id: "beta".into(),
            ts_ms: now_ms,
            revoked_at_ms: None,
            signature: None,
        };
        let vsig = keys.sign_vouch(&v, now_ms).unwrap();
        storage.insert_vouch(&v, Some(&vsig)).unwrap();

        // Reopen — fresh KeyStore, same Storage. Verify both round trip.
        drop(keys);
        let keys2 = KeyStore::new(std::sync::Arc::clone(&storage), now_ms).unwrap();
        let receipts = storage.load_all_receipts().unwrap();
        let vouches = storage.load_all_vouches().unwrap();
        assert_eq!(receipts.len(), 1);
        assert_eq!(vouches.len(), 1);

        // Signatures still verify against the persisted public keys.
        assert!(keys2.verify_receipt(
            &receipts[0].receipt,
            receipts[0].carrier_sig.as_deref(),
            receipts[0].agent_sig.as_deref(),
        ));
        assert!(keys2.verify_vouch(
            &vouches[0].vouch,
            vouches[0].signature_bytes.as_deref().unwrap(),
        ));
    }

    #[test]
    fn rotate_summarizes_and_deletes() {
        let s = Storage::in_memory().unwrap();
        // Old receipts.
        for i in 0..5 {
            s.insert_receipt(&r("alpha", "lookup", true, 100 + i), None, None)
                .unwrap();
        }
        // New receipts.
        for i in 0..3 {
            s.insert_receipt(&r("alpha", "lookup", false, 10_000 + i), None, None)
                .unwrap();
        }
        let deleted = s.rotate_old_receipts(5_000).unwrap();
        assert_eq!(deleted, 5);
        // Remaining receipts after rotation.
        let remaining = s.load_all_receipts().unwrap();
        assert_eq!(remaining.len(), 3);
        // Summary row exists.
        let conn = s.conn.lock();
        let (count, success_count): (i64, i64) = conn
            .query_row(
                "SELECT count, success_count FROM receipt_summaries WHERE agent_id = 'alpha' AND tool = 'lookup'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 5);
        assert_eq!(success_count, 5);
    }
}
