// In-memory receipt store. v0 keeps the last N receipts, no persistence,
// no signing. The substrate behind RouteRank ranking (step 5a, see
// `docs/route_rank_plan.md`) and `carrier_status`.
//
// Persistence + cryptographic signing per `docs/strategic_update.md §4.2`
// land in step 5c. The shape here grows without a rewrite.

use std::collections::{HashMap, VecDeque};

use serde::Serialize;

const CAPACITY: usize = 1000;

/// Coarse classification of a failed call, attached to the receipt.
/// Drives `error_kind`-aware reliability decay later (e.g. weighting
/// `Transport` failures less than `JsonRpc` errors when the latter
/// indicate a server-side disagreement). 5a doesn't yet use the variant
/// in scoring — recording it now means 5b/5c don't need a backfill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Transport,
    JsonRpc,
    Timeout,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct Receipt {
    pub agent_id: String,
    pub tool: String,
    pub success: bool,
    pub latency_ms: u64,
    pub ts_ms: i64,
    /// Set on failures; `None` on successes. Coarse classification —
    /// scoring uses it as a feature, not as a gating signal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<ErrorKind>,
    /// True when this call was placed against an `Exploration`-state
    /// agent via the cold-start allocation path (`§3.2` bonded exposure).
    /// Exploration receipts inform exploration-confidence and the
    /// state-transition counter; they are excluded from production
    /// reliability and authority computations.
    #[serde(skip_serializing_if = "is_false")]
    pub exploratory: bool,
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_false(b: &bool) -> bool {
    !*b
}

/// Receipts are stored as a single ring buffer (FIFO eviction) with a
/// sibling index keyed by `(agent_id, tool)`. The index lets scoring
/// functions iterate per-(agent,tool) receipts in O(K) without rescanning
/// the whole buffer, where K is the count for that pair.
///
/// Index correctness invariant: each receipt in `queue` at position p
/// has implicit `seq = oldest_seq + p`. Each `(agent, tool)` deque holds
/// the seq ids of its receipts in insertion order. Eviction advances
/// `oldest_seq` and pops the corresponding seq from the matching index
/// entry — kept in lockstep so absolute seq ids stay consistent.
pub struct ReceiptStore {
    queue: VecDeque<Receipt>,
    oldest_seq: u64,
    by_agent_tool: HashMap<(String, String), VecDeque<u64>>,
}

impl Default for ReceiptStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ReceiptStore {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::with_capacity(CAPACITY),
            oldest_seq: 0,
            by_agent_tool: HashMap::new(),
        }
    }

    pub fn record(&mut self, r: Receipt) {
        let next_seq = self.oldest_seq + self.queue.len() as u64;

        if self.queue.len() == CAPACITY {
            // Evict the front; lockstep prune the index.
            let evicted = self.queue.pop_front().expect("len == CAPACITY");
            self.oldest_seq += 1;
            let key = (evicted.agent_id, evicted.tool);
            if let Some(seqs) = self.by_agent_tool.get_mut(&key) {
                seqs.pop_front();
                if seqs.is_empty() {
                    self.by_agent_tool.remove(&key);
                }
            }
        }

        let key = (r.agent_id.clone(), r.tool.clone());
        self.queue.push_back(r);
        self.by_agent_tool
            .entry(key)
            .or_default()
            .push_back(next_seq);
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Receipts for `(agent_id, tool)` in insertion order. Allocates a
    /// small Vec rather than fight a borrowed iterator; v0 working set
    /// is 1k receipts so this stays cheap. If perf demands later, swap
    /// to a custom iterator that closes over the seq deque.
    pub fn iter_for(&self, agent_id: &str, tool: &str) -> Vec<&Receipt> {
        let key = (agent_id.to_string(), tool.to_string());
        match self.by_agent_tool.get(&key) {
            None => Vec::new(),
            Some(seqs) => seqs
                .iter()
                .map(|&seq| {
                    let pos = (seq - self.oldest_seq) as usize;
                    &self.queue[pos]
                })
                .collect(),
        }
    }

    /// All receipts in insertion order. Used by authority scoring to
    /// build the call graph.
    pub fn iter_all(&self) -> impl Iterator<Item = &Receipt> {
        self.queue.iter()
    }

    /// Most recent successful receipt for `(agent_id, tool)`, if any.
    /// Retained for back-compat with any non-scoring callers; scoring
    /// itself now goes through `iter_for`.
    pub fn last_success(&self, agent_id: &str, tool: &str) -> Option<&Receipt> {
        self.iter_for(agent_id, tool)
            .into_iter()
            .rev()
            .find(|r| r.success)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(agent: &str, tool: &str, success: bool, latency_ms: u64, ts_ms: i64) -> Receipt {
        Receipt {
            agent_id: agent.into(),
            tool: tool.into(),
            success,
            latency_ms,
            ts_ms,
            error_kind: if success { None } else { Some(ErrorKind::Other) },
            exploratory: false,
        }
    }

    #[test]
    fn iter_for_returns_only_matching_pair() {
        let mut s = ReceiptStore::new();
        s.record(r("alpha", "lookup", true, 10, 100));
        s.record(r("beta", "lookup", true, 20, 200));
        s.record(r("alpha", "lookup", false, 30, 300));
        s.record(r("alpha", "other", true, 40, 400));

        let alpha_lookup = s.iter_for("alpha", "lookup");
        assert_eq!(alpha_lookup.len(), 2);
        assert_eq!(alpha_lookup[0].latency_ms, 10);
        assert_eq!(alpha_lookup[1].latency_ms, 30);

        let beta_lookup = s.iter_for("beta", "lookup");
        assert_eq!(beta_lookup.len(), 1);
        assert_eq!(beta_lookup[0].latency_ms, 20);
    }

    #[test]
    fn eviction_advances_oldest_seq_and_prunes_index() {
        let mut s = ReceiptStore::new();
        // Fill past capacity to force eviction.
        for i in 0..CAPACITY + 5 {
            s.record(r("alpha", "lookup", true, 1, i as i64));
        }
        assert_eq!(s.len(), CAPACITY);
        let v = s.iter_for("alpha", "lookup");
        assert_eq!(v.len(), CAPACITY);
        // Front receipt should be the 5th one we inserted (5 evicted).
        assert_eq!(v[0].ts_ms, 5);
        // Back receipt is the most recent.
        assert_eq!(v[v.len() - 1].ts_ms, (CAPACITY + 4) as i64);
    }

    #[test]
    fn eviction_removes_empty_index_entries() {
        let mut s = ReceiptStore::new();
        s.record(r("alpha", "rare", true, 1, 0));
        // Fill the rest of the buffer with a different pair so "alpha,rare"
        // gets evicted.
        for i in 0..CAPACITY {
            s.record(r("beta", "common", true, 1, i as i64 + 1));
        }
        assert_eq!(s.iter_for("alpha", "rare").len(), 0);
    }

    #[test]
    fn last_success_skips_failures() {
        let mut s = ReceiptStore::new();
        s.record(r("alpha", "lookup", true, 10, 100));
        s.record(r("alpha", "lookup", false, 20, 200));
        let last = s.last_success("alpha", "lookup").unwrap();
        assert_eq!(last.ts_ms, 100);
    }
}
