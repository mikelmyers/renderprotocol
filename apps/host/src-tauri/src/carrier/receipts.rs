// In-memory receipt store. v0 keeps the last N receipts, no persistence,
// no signing. Used today for: (a) ranking input ("lowest recent latency"
// for multi-provider tools) and (b) the carrier_status surface.
//
// Persistence + cryptographic signing per `docs/strategic_update.md §4.2`
// land alongside RouteRank in step 5. The shape here is deliberately
// minimal so it can grow without a rewrite.

use std::collections::VecDeque;

use serde::Serialize;

const CAPACITY: usize = 1000;

#[derive(Debug, Clone, Serialize)]
pub struct Receipt {
    pub agent_id: String,
    pub tool: String,
    pub success: bool,
    pub latency_ms: u64,
    pub ts_ms: i64,
}

pub struct ReceiptStore {
    queue: VecDeque<Receipt>,
}

impl ReceiptStore {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::with_capacity(CAPACITY),
        }
    }

    pub fn record(&mut self, r: Receipt) {
        if self.queue.len() == CAPACITY {
            self.queue.pop_front();
        }
        self.queue.push_back(r);
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// Most recent successful receipt for this agent + tool, if any.
    /// Used as the v0 ranking signal: providers with lower last-success
    /// latency get picked first. Cold-start providers (no successes yet)
    /// return None — caller treats that as priority-for-exploration.
    pub fn last_success(&self, agent_id: &str, tool: &str) -> Option<&Receipt> {
        self.queue
            .iter()
            .rev()
            .find(|r| r.success && r.agent_id == agent_id && r.tool == tool)
    }
}
