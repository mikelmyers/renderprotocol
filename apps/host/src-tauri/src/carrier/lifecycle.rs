// Per-agent lifecycle state. Drives the cold-start mechanism from
// `docs/strategic_update.md §3.2` / `docs/route_rank_plan.md §4`.
//
// The lifecycle has been refined against published stake-and-slash
// systems (Ethereum, Cosmos, EigenLayer) and reputation-system
// promotion rules (Stripe Radar, Yelp, ad-fraud). Two structural
// corrections from the original plan-doc draft:
//
//   1. Promotion uses a four-gate hybrid (count floor + Bayesian
//      credible interval + tenure floor + clean adversarial record),
//      not a fixed call-count threshold. Pure Bayesian gates are
//      unstable for first-failure agents; pure count gates promote
//      lucky-streak agents alongside genuinely consistent ones.
//
//   2. Adversarial-resistance trip introduces a TWO-TIER response,
//      not auto-Forfeit. Tier 1 (soft, reversible): Suspended state.
//      Tier 2 (hard, irreversible): Forfeit. v0 ships Tier 1 only —
//      auto-Forfeit on continuous AR alone is the kind of decision
//      that becomes a public incident the first time it misfires.
//      Tier 2's categorical-evidence layer waits for 5c (signed
//      receipts make "≥1 cryptographically invalid receipt" a real
//      signal). Manual Forfeit via admin command stays available.
//
// State transitions:
//   Exploration → Production: four promotion gates all satisfied.
//   Exploration → Suspended:  AR < 0.3 (Tier 1 trip).
//   Production  → Suspended:  AR < 0.3 (Tier 1 also applies to
//                             established agents).
//   Suspended   → Exploration: AR ≥ 0.6 sustained for 48h. Counters
//                             are reset (re-earn promotion through
//                             full re-exploration).
//   Any         → Forfeit:    only via manual admin command in v0.

use serde::Serialize;

/// Minimum count of total exploration calls (successes + failures)
/// before promotion is even considered. Rules out lucky-streak agents:
/// research consensus is that pure-count thresholds without a floor
/// reproduce the "1 success → promote" failure mode.
pub const PROMOTION_MIN_CALLS: u32 = 50;

/// Bayesian credible-interval target reliability. Promote when the
/// posterior is ≥ PROMOTION_CONFIDENCE confident the success rate is
/// at least this high.
pub const PROMOTION_RELIABILITY_THRESHOLD: f64 = 0.85;

/// Confidence required for the Bayesian gate. P(p ≥ threshold) ≥ 0.95.
pub const PROMOTION_CONFIDENCE: f64 = 0.95;

/// Calendar tenure floor before promotion is considered. Rules out
/// burst-and-promote sybil attacks — calendar time can't be faked by
/// rapid synthetic activity.
pub const PROMOTION_MIN_TENURE_MS: i64 = 7 * 24 * 3600 * 1000;

/// Minimum adversarial-resistance score the agent must have maintained
/// throughout exploration to qualify for promotion. A dip below this
/// during exploration disqualifies the run; the agent must clear it
/// (likely via Suspended → Exploration cycle) before promotion.
pub const PROMOTION_MIN_AR: f64 = 0.5;

/// Tier 1 trip threshold. AR below this triggers Suspended state for
/// any agent regardless of current state.
pub const TIER1_SUSPEND_AR_THRESHOLD: f64 = 0.3;

/// Tier 1 recovery threshold. AR must rise above this *and* stay there
/// for TIER1_RECOVERY_DURATION_MS before Suspended → Exploration
/// resume.
pub const TIER1_RECOVERY_AR_THRESHOLD: f64 = 0.6;

/// Continuous duration AR must remain above the recovery threshold
/// before resume. 48h gives operator time to investigate and lets a
/// transient AR spike-and-recover not auto-resume too quickly.
pub const TIER1_RECOVERY_DURATION_MS: i64 = 48 * 3600 * 1000;

/// Fraction of matching queries forced to `Exploration`-state agents
/// when any are ready, regardless of score. 1–3% per `§3.2`; 2% is the
/// v0 default. `Suspended` agents are NOT eligible for this allocation.
pub const EXPLORATION_ALLOCATION_FRACTION: f64 = 0.02;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AgentLifecycle {
    /// New agent earning trust through bounded exposure. Receipts from
    /// exploration calls have `exploratory: true` and don't count toward
    /// production reliability or authority.
    Exploration {
        /// Successful exploratory calls accumulated so far.
        successes_so_far: u32,
        /// Failed exploratory calls accumulated so far.
        failures_so_far: u32,
        /// Wall-clock entry time. Drives the calendar-tenure gate.
        entered_at_ms: i64,
        /// Lowest AR observed during this exploration run. Promotion
        /// requires ≥ PROMOTION_MIN_AR; a dip below this disqualifies
        /// until the agent clears Suspended → Exploration and starts
        /// over with a fresh min observation.
        min_ar_observed: f64,
    },
    /// Established agent. Competes normally for routing, eligible for
    /// vouching (subject to reliability + tenure thresholds), eligible
    /// for kernel promotion.
    Production { since_ms: i64 },
    /// Tier 1 soft-action: AR breached the Tier 1 threshold.
    /// Excluded from picker (no traffic), bond frozen pending review.
    /// Auto-resumes to Exploration when AR ≥ recovery threshold for
    /// the recovery duration. Resume always lands in Exploration with
    /// reset counters — the agent re-earns trust through full
    /// re-exploration. Conservative by design.
    Suspended {
        since_ms: i64,
        /// AR at the moment of suspension. Telemetry; not used by the
        /// recovery decision.
        ar_at_suspension: f64,
        /// `Some(ts)` once AR has risen ≥ recovery threshold. If AR
        /// drops back below threshold while in this state, this resets
        /// to None — the recovery window must be continuous.
        ar_recovery_started_ms: Option<i64>,
    },
    /// Bond forfeited — only via manual admin command in v0. Tier 2
    /// auto-forfeit (categorical-evidence-gated) is a 5c concern;
    /// continuous AR alone never auto-forfeits.
    Forfeit {
        at_ms: i64,
        reason: ForfeitReason,
    },
}

impl AgentLifecycle {
    /// Initial state for a freshly-onboarded agent. Seed-anchor agents
    /// (per `HostingAgentSpec.seed`) skip exploration and start in
    /// `Production`.
    pub fn initial(seed: bool, now_ms: i64) -> Self {
        if seed {
            AgentLifecycle::Production { since_ms: now_ms }
        } else {
            AgentLifecycle::Exploration {
                successes_so_far: 0,
                failures_so_far: 0,
                entered_at_ms: now_ms,
                min_ar_observed: 1.0,
            }
        }
    }

    pub fn is_exploration(&self) -> bool {
        matches!(self, AgentLifecycle::Exploration { .. })
    }

    pub fn is_production(&self) -> bool {
        matches!(self, AgentLifecycle::Production { .. })
    }

    pub fn is_suspended(&self) -> bool {
        matches!(self, AgentLifecycle::Suspended { .. })
    }

    pub fn is_forfeit(&self) -> bool {
        matches!(self, AgentLifecycle::Forfeit { .. })
    }

    /// True when the agent is eligible for routing decisions.
    /// Suspended and Forfeit agents are excluded from the picker.
    pub fn is_routable(&self) -> bool {
        matches!(
            self,
            AgentLifecycle::Exploration { .. } | AgentLifecycle::Production { .. }
        )
    }

    /// Tenure in ms since the agent entered `Production`. Returns 0 for
    /// agents not yet in `Production`.
    pub fn production_tenure_ms(&self, now_ms: i64) -> i64 {
        match self {
            AgentLifecycle::Production { since_ms } => (now_ms - since_ms).max(0),
            _ => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ForfeitReason {
    /// Sybil-topology score categorically tripped (5c): cryptographic
    /// shared-key correlations confirmed. Slot reserved.
    SybilTopologyTrip,
    /// Velocity rate ≥ 10x p99 of cohort with corroborating evidence
    /// (5c). Slot reserved.
    VelocityAnomalyTrip,
    /// At least one cryptographically-invalid receipt detected (5c).
    /// Slot reserved.
    ReceiptConsistencyTrip,
    /// Manual administrative forfeit. The only ForfeitReason that
    /// auto-trips in v0; the others wait for 5c's categorical-evidence
    /// layer.
    Manual,
}
