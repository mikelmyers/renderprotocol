// Vouch graph for RouteRank step 5b. See `docs/route_rank_plan.md §4`.
//
// A vouch is one Production-state agent endorsing another. Vouches are:
//   - Earned (only Production-state agents with reliability ≥ 0.8 and
//     tenure ≥ 50 successful production calls are eligible to vouch),
//   - Mutual-liability (when a vouchee misbehaves, the voucher's
//     authority is penalized — see `scoring::authority`),
//   - Non-instant (1-hour revocation cooldown blocks the
//     "vouch-widely / instant-revoke" attack),
//   - Cycle-aware (vouch_boost divides cycle members' contributions by
//     cycle length — closes the trivial mutual-vouching exploit).
//
// v0: vouches are unsigned, in-memory, capped. Cryptographic signing
// arrives with receipts in 5c; persistence + admin UI also in 5c. The
// shape here is deliberately minimal so the 5c expansion lands without
// a rewrite.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

/// Capacity ceiling for the in-memory vouch buffer. v0 networks are
/// small; 10k handles ~100 active agents each making ~100 outstanding
/// vouches without falling off. Eviction policy: oldest revoked first,
/// then oldest active (rare — the cap is for safety, not steady state).
const CAPACITY: usize = 10_000;

/// Minimum time a vouch must remain active before it can be revoked.
/// Per `docs/route_rank_plan.md §4.4`. Blocks the "vouch widely now,
/// instant-revoke when bad" attack.
pub const REVOCATION_COOLDOWN_MS: i64 = 60 * 60 * 1000; // 1 hour

#[derive(Debug, Clone, Serialize)]
pub struct Vouch {
    pub voucher_id: String,
    pub vouchee_id: String,
    pub ts_ms: i64,
    /// `Some(ts)` when the vouch was revoked. Revoked vouches stay in
    /// the store (for audit / cycle-detection history) but contribute
    /// nothing to scoring.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at_ms: Option<i64>,
    /// Reserved for 5c. v0 vouches are unsigned; 5c adds Ed25519
    /// keypairs per agent and verifies signatures on every read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

impl Vouch {
    pub fn is_active(&self) -> bool {
        self.revoked_at_ms.is_none()
    }
}

/// Why a submitted vouch was rejected. Returned to the caller for
/// telemetry / debugging; the submission outcome is otherwise silent
/// (see `VouchStore::insert` documentation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VouchInsertOutcome {
    /// Vouch recorded.
    Inserted,
    /// Voucher was not eligible (not Production state, reliability too
    /// low, or insufficient tenure). The store deliberately silently
    /// drops these so attackers can't probe the eligibility threshold —
    /// the outcome is returned to the caller for logging only.
    IneligibleVoucher,
    /// Voucher and vouchee are the same agent. Self-vouching is
    /// nonsensical and structurally suspicious.
    SelfVouch,
    /// An identical active vouch already exists from this voucher to
    /// this vouchee. Idempotent — re-submission is a no-op.
    AlreadyActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VouchRevokeOutcome {
    Revoked,
    /// No active vouch from this voucher to this vouchee.
    NotFound,
    /// Vouch is still inside its 1-hour cooldown window.
    CooldownActive,
}

pub struct VouchStore {
    queue: VecDeque<Vouch>,
}

impl Default for VouchStore {
    fn default() -> Self {
        Self::new()
    }
}

impl VouchStore {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::with_capacity(CAPACITY.min(1024)),
        }
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Eligibility for the *voucher* (called at insert time). Returns
    /// `true` only when:
    ///   - voucher is in Production state,
    ///   - voucher's overall recency-weighted reliability is ≥ 0.8,
    ///   - voucher has at least N successful production-state calls in
    ///     their history.
    ///
    /// Pure function — caller composes from runtime sources.
    pub fn is_voucher_eligible(
        in_production: bool,
        overall_reliability: f64,
        successful_production_calls: u32,
    ) -> bool {
        in_production
            && overall_reliability >= 0.8
            && successful_production_calls >= 50
    }

    /// Insert a vouch. Caller pre-checks voucher eligibility via
    /// `is_voucher_eligible` and passes the result; the store does
    /// final-mile sanity checks (self-vouch, duplicate active vouch)
    /// and records.
    ///
    /// Silently drops ineligible vouchers — attackers shouldn't be able
    /// to probe the threshold by trying to submit. The outcome value is
    /// for telemetry only; the on-disk record is identical regardless.
    pub fn insert(
        &mut self,
        voucher_id: &str,
        vouchee_id: &str,
        ts_ms: i64,
        voucher_eligible: bool,
    ) -> VouchInsertOutcome {
        if voucher_id == vouchee_id {
            return VouchInsertOutcome::SelfVouch;
        }
        if !voucher_eligible {
            return VouchInsertOutcome::IneligibleVoucher;
        }
        // Idempotent: existing active vouch from this voucher → vouchee
        // is a no-op.
        if self.queue.iter().any(|v| {
            v.is_active() && v.voucher_id == voucher_id && v.vouchee_id == vouchee_id
        }) {
            return VouchInsertOutcome::AlreadyActive;
        }
        if self.queue.len() == CAPACITY {
            self.evict_one();
        }
        self.queue.push_back(Vouch {
            voucher_id: voucher_id.to_string(),
            vouchee_id: vouchee_id.to_string(),
            ts_ms,
            revoked_at_ms: None,
            signature: None,
        });
        VouchInsertOutcome::Inserted
    }

    /// Re-insert a previously persisted (and signature-verified) vouch
    /// from storage hydration. Bypasses eligibility / self-vouch /
    /// duplicate checks because those were enforced at original insert
    /// time and the persisted state is the authoritative record.
    /// Storage layer is the gatekeeper here, not the in-memory store.
    pub fn insert_loaded(&mut self, v: Vouch) {
        if self.queue.len() >= CAPACITY {
            self.evict_one();
        }
        self.queue.push_back(v);
    }

    /// Mark the active vouch from `voucher_id` to `vouchee_id` as
    /// revoked, if one exists and the cooldown has elapsed.
    pub fn revoke(
        &mut self,
        voucher_id: &str,
        vouchee_id: &str,
        now_ms: i64,
    ) -> VouchRevokeOutcome {
        let pos = self.queue.iter().position(|v| {
            v.is_active() && v.voucher_id == voucher_id && v.vouchee_id == vouchee_id
        });
        let Some(idx) = pos else {
            return VouchRevokeOutcome::NotFound;
        };
        let v = &self.queue[idx];
        if now_ms - v.ts_ms < REVOCATION_COOLDOWN_MS {
            return VouchRevokeOutcome::CooldownActive;
        }
        self.queue[idx].revoked_at_ms = Some(now_ms);
        VouchRevokeOutcome::Revoked
    }

    /// Iterate all vouches (active + revoked) in insertion order.
    pub fn iter_all(&self) -> impl Iterator<Item = &Vouch> {
        self.queue.iter()
    }

    /// Active vouches received by `vouchee_id`.
    pub fn active_for_vouchee(&self, vouchee_id: &str) -> Vec<&Vouch> {
        self.queue
            .iter()
            .filter(|v| v.is_active() && v.vouchee_id == vouchee_id)
            .collect()
    }

    /// Active vouches made by `voucher_id`.
    pub fn active_by_voucher(&self, voucher_id: &str) -> Vec<&Vouch> {
        self.queue
            .iter()
            .filter(|v| v.is_active() && v.voucher_id == voucher_id)
            .collect()
    }

    /// Set of agent IDs that currently appear as either a voucher or
    /// a vouchee in any active vouch. Useful for adversarial-resistance
    /// scoring (only evaluate sybil topology for agents that have any
    /// graph context).
    pub fn agents_in_active_graph(&self) -> HashSet<String> {
        let mut out = HashSet::new();
        for v in self.queue.iter().filter(|v| v.is_active()) {
            out.insert(v.voucher_id.clone());
            out.insert(v.vouchee_id.clone());
        }
        out
    }

    /// Adjacency map of active vouches: `voucher → set of vouchees`.
    /// Used by clustering-coefficient and cycle-detection passes.
    pub fn outbound_adjacency(&self) -> HashMap<String, HashSet<String>> {
        let mut adj: HashMap<String, HashSet<String>> = HashMap::new();
        for v in self.queue.iter().filter(|v| v.is_active()) {
            adj.entry(v.voucher_id.clone())
                .or_default()
                .insert(v.vouchee_id.clone());
        }
        adj
    }

    fn evict_one(&mut self) {
        // Prefer evicting the oldest revoked vouch; if none revoked,
        // fall back to the oldest active. Rare path — cap is a safety
        // ceiling, not a steady-state churn point.
        let revoked_idx = self
            .queue
            .iter()
            .position(|v| v.revoked_at_ms.is_some());
        if let Some(idx) = revoked_idx {
            self.queue.remove(idx);
        } else {
            self.queue.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligible_voucher_inserts() {
        let mut s = VouchStore::new();
        assert_eq!(
            s.insert("alpha", "beta", 1000, true),
            VouchInsertOutcome::Inserted
        );
        assert_eq!(s.len(), 1);
    }

    #[test]
    fn ineligible_voucher_silently_dropped() {
        let mut s = VouchStore::new();
        assert_eq!(
            s.insert("attacker", "victim", 1000, false),
            VouchInsertOutcome::IneligibleVoucher
        );
        assert_eq!(s.len(), 0);
    }

    #[test]
    fn self_vouch_rejected() {
        let mut s = VouchStore::new();
        assert_eq!(
            s.insert("alpha", "alpha", 1000, true),
            VouchInsertOutcome::SelfVouch
        );
        assert_eq!(s.len(), 0);
    }

    #[test]
    fn duplicate_active_vouch_is_noop() {
        let mut s = VouchStore::new();
        s.insert("alpha", "beta", 1000, true);
        assert_eq!(
            s.insert("alpha", "beta", 2000, true),
            VouchInsertOutcome::AlreadyActive
        );
        assert_eq!(s.len(), 1);
    }

    #[test]
    fn revocation_cooldown_blocks_immediate_revoke() {
        let mut s = VouchStore::new();
        s.insert("alpha", "beta", 1000, true);
        // 30 minutes later — still inside the 1-hour cooldown.
        assert_eq!(
            s.revoke("alpha", "beta", 1000 + 30 * 60 * 1000),
            VouchRevokeOutcome::CooldownActive
        );
        // Still active.
        assert_eq!(s.active_for_vouchee("beta").len(), 1);
    }

    #[test]
    fn revocation_after_cooldown_succeeds() {
        let mut s = VouchStore::new();
        s.insert("alpha", "beta", 1000, true);
        let after_cooldown = 1000 + REVOCATION_COOLDOWN_MS + 1;
        assert_eq!(
            s.revoke("alpha", "beta", after_cooldown),
            VouchRevokeOutcome::Revoked
        );
        assert_eq!(s.active_for_vouchee("beta").len(), 0);
    }

    #[test]
    fn voucher_eligibility_thresholds() {
        // Production + reliability + tenure all satisfied.
        assert!(VouchStore::is_voucher_eligible(true, 0.85, 60));
        // Below reliability.
        assert!(!VouchStore::is_voucher_eligible(true, 0.79, 60));
        // Below tenure.
        assert!(!VouchStore::is_voucher_eligible(true, 0.85, 49));
        // Not in Production.
        assert!(!VouchStore::is_voucher_eligible(false, 0.95, 100));
    }

    #[test]
    fn outbound_adjacency_collects_active_only() {
        let mut s = VouchStore::new();
        s.insert("alpha", "beta", 0, true);
        s.insert("alpha", "gamma", 0, true);
        s.insert("beta", "gamma", 0, true);
        // Revoke one (after cooldown).
        s.revoke("alpha", "beta", REVOCATION_COOLDOWN_MS + 1);
        let adj = s.outbound_adjacency();
        assert_eq!(adj.get("alpha").unwrap().len(), 1);
        assert!(adj.get("alpha").unwrap().contains("gamma"));
        assert_eq!(adj.get("beta").unwrap().len(), 1);
    }
}
